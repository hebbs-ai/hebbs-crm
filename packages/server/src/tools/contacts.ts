// CRM contact tools — list / get / create / update / delete.
// Dispatched at /api/tools/crm.contacts.<name>. tenantId comes
// from the JWT context; ownerId comes from the input (the shell
// passes the calling user; agents pass an explicit owner).

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { eq, and, ilike, or, sql } from "drizzle-orm";
import { contacts } from "../schema/contacts.js";
import { logActivity, describeContactChanges } from "../activity-logger.js";
import { emitCrm, type CrmDeps } from "./deps.js";

/**
 * Create a stub deal for a contact in the first open stage of the default
 * pipeline. Idempotent — returns the existing open deal if one is already
 * attached. Shared by the `contacts.promote_to_deal` tool, the
 * deal-on-reply workflow, and the email-lens "add to pipeline" action.
 */
export async function promoteContactToDeal(
  deps: CrmDeps,
  tenantId: string,
  input: { contactId: string; source: string; itemId?: string | null; title?: string },
): Promise<ToolResult> {
  const rows = await deps.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.tenantId, tenantId)))
    .limit(1);
  const contact = rows[0];
  if (!contact) {
    return { ok: false, error: { code: "not_found", message: "Contact not found", retryable: false } };
  }

  const openRows = (await deps.db.execute(sql`
    SELECT d.id
    FROM crm__deals d
    LEFT JOIN crm__pipeline_stages s ON s.id = d.stage_id
    WHERE d.tenant_id = ${tenantId}
      AND d.contact_id = ${input.contactId}
      AND (s.type IS NULL OR s.type NOT IN ('won', 'lost'))
    ORDER BY d.updated_at DESC
    LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  if (openRows[0]) {
    return { ok: true, result: { dealId: openRows[0].id, created: false, reason: "already_has_open_deal" } };
  }

  const stageRows = (await deps.db.execute(sql`
    SELECT s.id, s.pipeline_id FROM crm__pipeline_stages s
    JOIN crm__pipelines p ON p.id = s.pipeline_id
    WHERE p.tenant_id = ${tenantId} AND p.is_default = true AND s.type = 'open'
    ORDER BY s.sort_order ASC
    LIMIT 1
  `)) as unknown as Array<{ id: string; pipeline_id: string }>;
  if (!stageRows[0]) {
    return { ok: false, error: { code: "internal", message: "Default pipeline has no open stages; cannot create a deal.", retryable: false } };
  }

  const dealId = crypto.randomUUID();
  const dealTitle =
    input.title?.trim()
      || `${contact.firstName} ${contact.lastName ?? ""}`.trim()
      || contact.email
      || "Untitled deal";
  await deps.db.execute(sql`
    INSERT INTO crm__deals (
      id, tenant_id, owner_id, title, value, currency,
      pipeline_id, stage_id, contact_id, company_id, custom_fields, created_at, updated_at
    ) VALUES (
      ${dealId}, ${tenantId}, ${tenantId},
      ${dealTitle}, 0, 'USD',
      ${stageRows[0].pipeline_id}, ${stageRows[0].id},
      ${input.contactId}, ${contact.companyId}, '{}'::jsonb, now(), now()
    )
  `);

  await logActivity({
    db: deps.db,
    tenantId,
    subject: `Deal created from ${input.source}: ${dealTitle}`,
    dealId,
    contactId: input.contactId,
    companyId: contact.companyId,
    body: input.itemId ? `Triggered by inbox item ${input.itemId}` : undefined,
  });

  emitCrm(deps, "entity.created", tenantId, {
    entityType: "crm_deal",
    entityId: dealId,
    source: `promote_to_deal:${input.source}`,
  });

  return { ok: true, result: { dealId, created: true } };
}

export function createContactTools(deps: CrmDeps): Tool[] {
  const list: Tool = {
    name: "contacts.list",
    description:
      "List contacts for the current tenant. Supports search across firstName/lastName/email, plus filters on companyId and ownerId.",
    inputs: z.object({
      search: z.string().optional(),
      companyId: z.string().uuid().optional(),
      ownerId: z.string().uuid().optional(),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    async handler(
      input: {
        search?: string;
        companyId?: string;
        ownerId?: string;
        limit?: number;
        offset?: number;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const conds = [eq(contacts.tenantId, ctx.tenantId)];
      if (input.companyId) conds.push(eq(contacts.companyId, input.companyId));
      if (input.ownerId) conds.push(eq(contacts.ownerId, input.ownerId));
      if (input.search) {
        conds.push(
          or(
            ilike(contacts.firstName, `%${input.search}%`),
            ilike(contacts.lastName, `%${input.search}%`),
            ilike(contacts.email, `%${input.search}%`),
          )!,
        );
      }
      const where = and(...conds);
      const [rows, totalRow] = await Promise.all([
        deps.db
          .select()
          .from(contacts)
          .where(where)
          .limit(input.limit ?? 50)
          .offset(input.offset ?? 0),
        deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(contacts)
          .where(where),
      ]);
      return {
        ok: true,
        result: {
          data: rows,
          total: totalRow[0]?.n ?? rows.length,
          limit: input.limit ?? 50,
          offset: input.offset ?? 0,
        },
      };
    },
  };

  const get: Tool = {
    name: "contacts.get",
    description: "Fetch one contact by id.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const row = await deps.db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, input.id), eq(contacts.tenantId, ctx.tenantId)))
        .limit(1);
      if (!row.length) {
        return {
          ok: false,
          error: { code: "not_found", message: "Contact not found", retryable: false },
        };
      }
      return { ok: true, result: { data: row[0] } };
    },
  };

  const create: Tool = {
    name: "contacts.create",
    description:
      "Create a contact. ownerId defaults to the tenant if not supplied (single-user tenants); pass explicitly when the shell knows the calling user.",
    inputs: z.object({
      ownerId: z.string().uuid().optional(),
      firstName: z.string().min(1),
      lastName: z.string().default(""),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      companyId: z.string().uuid().optional(),
      title: z.string().optional(),
      linkedIn: z.string().optional(),
      source: z.string().optional(),
      tags: z.array(z.string()).optional(),
      customFields: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: {
        ownerId?: string;
        firstName: string;
        lastName: string;
        email?: string;
        phone?: string;
        companyId?: string;
        title?: string;
        linkedIn?: string;
        source?: string;
        tags?: string[];
        customFields?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const ownerId = input.ownerId ?? ctx.tenantId;
      const [created] = await deps.db
        .insert(contacts)
        .values({
          tenantId: ctx.tenantId,
          ownerId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          companyId: input.companyId ?? null,
          title: input.title ?? null,
          linkedIn: input.linkedIn ?? null,
          source: input.source ?? null,
          tags: input.tags ?? [],
          customFields: input.customFields ?? {},
        })
        .returning();

      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: ownerId,
        subject: `Contact created: ${created.firstName} ${created.lastName ?? ""}`.trim(),
        contactId: created.id,
        companyId: created.companyId,
      });

      // Wakes the enrichment-contact agent's workflow.
      emitCrm(deps, "entity.created", ctx.tenantId, {
        entityType: "crm_contact",
        entityId: created.id,
      });

      return { ok: true, result: { data: created } };
    },
  };

  const update: Tool = {
    name: "contacts.update",
    description: "Update a contact. Pass only the fields to change.",
    inputs: z.object({
      id: z.string().uuid(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      companyId: z.string().uuid().nullable().optional(),
      title: z.string().nullable().optional(),
      linkedIn: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      customFields: z.record(z.unknown()).optional(),
      /** If supplied, attributed in the activity log. */
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: {
        id: string;
        firstName?: string;
        lastName?: string;
        email?: string | null;
        phone?: string | null;
        companyId?: string | null;
        title?: string | null;
        linkedIn?: string | null;
        source?: string | null;
        tags?: string[];
        customFields?: Record<string, unknown>;
        actorUserId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const { id, actorUserId, ...patch } = input;

      const [old] = await deps.db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)))
        .limit(1);
      if (!old) {
        return {
          ok: false,
          error: { code: "not_found", message: "Contact not found", retryable: false },
        };
      }

      const [updated] = await deps.db
        .update(contacts)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)))
        .returning();

      if (!updated) {
        return {
          ok: false,
          error: { code: "not_found", message: "Contact not found", retryable: false },
        };
      }

      const changeDesc = describeContactChanges(
        old as unknown as Record<string, unknown>,
        patch as unknown as Record<string, unknown>,
      );
      if (changeDesc) {
        await logActivity({
          db: deps.db,
          tenantId: ctx.tenantId,
          userId: actorUserId,
          subject: `Contact updated: ${updated.firstName} ${updated.lastName ?? ""}`.trim(),
          body: changeDesc,
          contactId: updated.id,
          companyId: updated.companyId,
        });
        // Lets enrichment / dashboard listeners react to mutations.
        emitCrm(deps, "entity.updated", ctx.tenantId, {
          entityType: "crm_contact",
          entityId: updated.id,
          changes: changeDesc,
        });
      }

      return { ok: true, result: { data: updated } };
    },
  };

  const del: Tool = {
    name: "contacts.delete",
    description: "Delete a contact.",
    inputs: z.object({
      id: z.string().uuid(),
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: { id: string; actorUserId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const [deleted] = await deps.db
        .delete(contacts)
        .where(and(eq(contacts.id, input.id), eq(contacts.tenantId, ctx.tenantId)))
        .returning();

      if (!deleted) {
        return {
          ok: false,
          error: { code: "not_found", message: "Contact not found", retryable: false },
        };
      }

      const fullName = `${deleted.firstName} ${deleted.lastName ?? ""}`.trim();
      // The contact row is gone — contactId is null because the FK
      // would dangle. We keep companyId so the timeline still shows
      // the deletion under the company's tab, plus a body line that
      // names the contact and its now-stale id.
      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: input.actorUserId,
        subject: `Contact deleted: ${fullName}`,
        body: `Removed ${fullName} (${deleted.email ?? "no email"}). Id: ${deleted.id}`,
        contactId: null,
        companyId: deleted.companyId,
      });

      emitCrm(deps, "entity.deleted", ctx.tenantId, {
        entityType: "crm_contact",
        entityId: deleted.id,
      });

      return { ok: true, result: { data: deleted } };
    },
  };

  // Phase 4 — promote_to_deal.
  //
  // Creates a stub deal for the contact in the first open stage of
  // the default pipeline. Refuses to create duplicates: if the contact
  // already has an open deal, returns it untouched. Used both by the
  // "Create deal on reply" workflow (source="reply_sent") and by an
  // explicit UI button on the contact detail page (source="manual").
  const promote: Tool = {
    name: "contacts.promote_to_deal",
    description:
      "Create a stub deal for a contact in the first open stage of the default pipeline. Idempotent: returns the existing open deal if one is already attached to this contact. Use source='manual' for the UI button, 'reply_sent' for the workflow that fires when the user replies to an inbound email.",
    inputs: z.object({
      contactId: z.string().uuid(),
      source: z.enum(["manual", "reply_sent"]).default("manual"),
      itemId: z.string().uuid().nullable().optional(),
      title: z.string().optional(),
    }),
    async handler(
      input: {
        contactId: string;
        source: "manual" | "reply_sent";
        itemId?: string | null;
        title?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      return promoteContactToDeal(deps, ctx.tenantId, input);
    },
  };

  return [list, get, create, update, del, promote];
}
