// CRM contact tools — list / get / create / update / delete.
// Dispatched at /api/tools/crm.contacts.<name>. tenantId comes
// from the JWT context; ownerId comes from the input (the shell
// passes the calling user; agents pass an explicit owner).

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { eq, and, ilike, or } from "drizzle-orm";
import { contacts } from "../schema/contacts.js";
import { logActivity } from "../activity-logger.js";
import { emitCrm, type CrmDeps } from "./deps.js";

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
      const rows = await deps.db
        .select()
        .from(contacts)
        .where(and(...conds))
        .limit(input.limit ?? 50)
        .offset(input.offset ?? 0);
      return {
        ok: true,
        result: {
          data: rows,
          total: rows.length,
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
      const [created] = await deps.db
        .insert(contacts)
        .values({
          tenantId: ctx.tenantId,
          ownerId: input.ownerId ?? ctx.tenantId,
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
        userId: input.ownerId,
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

      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: actorUserId,
        subject: `Contact updated: ${updated.firstName} ${updated.lastName ?? ""}`.trim(),
        contactId: updated.id,
        companyId: updated.companyId,
      });

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

      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: input.actorUserId,
        subject: `Contact deleted: ${deleted.firstName} ${deleted.lastName ?? ""}`.trim(),
        companyId: deleted.companyId,
      });

      return { ok: true, result: { data: deleted } };
    },
  };

  return [list, get, create, update, del];
}
