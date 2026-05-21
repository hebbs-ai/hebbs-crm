// CRM company tools — list / get / create / update / delete.
// Dispatched at /api/tools/crm.companies.<name>. tenantId comes
// from the JWT context; ownerId comes from the input (the shell
// passes the calling user; agents pass an explicit owner).

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { eq, and, ilike, or, sql } from "drizzle-orm";
import { companies } from "../schema/companies.js";
import { logActivity, describeCompanyChanges } from "../activity-logger.js";
import { emitCrm, type CrmDeps } from "./deps.js";

export function createCompanyTools(deps: CrmDeps): Tool[] {
  const list: Tool = {
    name: "companies.list",
    description:
      "List companies for the current tenant. Supports search across name/domain, plus a filter on ownerId.",
    inputs: z.object({
      search: z.string().optional(),
      ownerId: z.string().uuid().optional(),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    async handler(
      input: {
        search?: string;
        ownerId?: string;
        limit?: number;
        offset?: number;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const conds = [eq(companies.tenantId, ctx.tenantId)];
      if (input.ownerId) conds.push(eq(companies.ownerId, input.ownerId));
      if (input.search) {
        conds.push(
          or(
            ilike(companies.name, `%${input.search}%`),
            ilike(companies.domain, `%${input.search}%`),
          )!,
        );
      }
      const where = and(...conds);
      const [rows, totalRow] = await Promise.all([
        deps.db
          .select()
          .from(companies)
          .where(where)
          .limit(input.limit ?? 50)
          .offset(input.offset ?? 0),
        deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(companies)
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
    name: "companies.get",
    description: "Fetch one company by id.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const row = await deps.db
        .select()
        .from(companies)
        .where(and(eq(companies.id, input.id), eq(companies.tenantId, ctx.tenantId)))
        .limit(1);
      if (!row.length) {
        return {
          ok: false,
          error: { code: "not_found", message: "Company not found", retryable: false },
        };
      }
      return { ok: true, result: { data: row[0] } };
    },
  };

  const create: Tool = {
    name: "companies.create",
    description:
      "Create a company. ownerId defaults to the tenant if not supplied (single-user tenants); pass explicitly when the shell knows the calling user.",
    inputs: z.object({
      ownerId: z.string().uuid().optional(),
      name: z.string().min(1),
      domain: z.string().optional(),
      industry: z.string().optional(),
      size: z.string().optional(),
      website: z.string().optional(),
      address: z.string().optional(),
      customFields: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: {
        ownerId?: string;
        name: string;
        domain?: string;
        industry?: string;
        size?: string;
        website?: string;
        address?: string;
        customFields?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const ownerId = input.ownerId ?? ctx.tenantId;

      // Domain dedupe — concurrent create calls for the same
      // (tenant, domain) used to produce duplicate rows because the
      // agent often issues parallel tool calls. We rely on the
      // partial unique index `crm__companies_tenant_domain_uniq` for
      // race correctness and use INSERT ... ON CONFLICT DO NOTHING
      // so the loser of the race silently no-ops; the follow-up
      // SELECT returns the winning row either way.
      if (input.domain) {
        const inserted = await deps.db
          .insert(companies)
          .values({
            tenantId: ctx.tenantId,
            ownerId,
            name: input.name,
            domain: input.domain,
            industry: input.industry ?? null,
            size: input.size ?? null,
            website: input.website ?? null,
            address: input.address ?? null,
            customFields: input.customFields ?? {},
          })
          .onConflictDoNothing({
            target: [companies.tenantId, companies.domain],
            // The arbiter index `crm__companies_tenant_domain_uniq` is
            // PARTIAL (`... WHERE domain IS NOT NULL`). Postgres only
            // accepts a partial unique index as an ON CONFLICT arbiter
            // when the clause restates that predicate — without this the
            // insert throws "there is no unique or exclusion constraint
            // matching the ON CONFLICT specification" and every create
            // that carries a domain fails.
            where: sql`${companies.domain} IS NOT NULL`,
          })
          .returning();
        if (inserted[0]) {
          await logActivity({
            db: deps.db,
            tenantId: ctx.tenantId,
            userId: ownerId,
            subject: `Company created: ${inserted[0].name}`,
            companyId: inserted[0].id,
          });
          emitCrm(deps, "entity.created", ctx.tenantId, {
            entityType: "crm_company",
            entityId: inserted[0].id,
          });
          return { ok: true, result: { data: inserted[0] } };
        }
        // Conflict path — return the existing winner.
        const existing = await deps.db
          .select()
          .from(companies)
          .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.domain, input.domain)))
          .limit(1);
        return { ok: true, result: { data: existing[0], deduped: true } };
      }

      const [created] = await deps.db
        .insert(companies)
        .values({
          tenantId: ctx.tenantId,
          ownerId,
          name: input.name,
          domain: null,
          industry: input.industry ?? null,
          size: input.size ?? null,
          website: input.website ?? null,
          address: input.address ?? null,
          customFields: input.customFields ?? {},
        })
        .returning();

      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: ownerId,
        subject: `Company created: ${created.name}`,
        companyId: created.id,
      });

      // Wakes the enrichment-company agent's workflow.
      emitCrm(deps, "entity.created", ctx.tenantId, {
        entityType: "crm_company",
        entityId: created.id,
      });

      return { ok: true, result: { data: created } };
    },
  };

  const update: Tool = {
    name: "companies.update",
    description: "Update a company. Pass only the fields to change.",
    inputs: z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      domain: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
      size: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      customFields: z.record(z.unknown()).optional(),
      /** If supplied, attributed in the activity log. */
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: {
        id: string;
        name?: string;
        domain?: string | null;
        industry?: string | null;
        size?: string | null;
        website?: string | null;
        address?: string | null;
        customFields?: Record<string, unknown>;
        actorUserId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const { id, actorUserId, ...patch } = input;

      const [old] = await deps.db
        .select()
        .from(companies)
        .where(and(eq(companies.id, id), eq(companies.tenantId, ctx.tenantId)))
        .limit(1);
      if (!old) {
        return {
          ok: false,
          error: { code: "not_found", message: "Company not found", retryable: false },
        };
      }

      const [updated] = await deps.db
        .update(companies)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(companies.id, id), eq(companies.tenantId, ctx.tenantId)))
        .returning();

      if (!updated) {
        return {
          ok: false,
          error: { code: "not_found", message: "Company not found", retryable: false },
        };
      }

      const changeDesc = describeCompanyChanges(
        old as unknown as Record<string, unknown>,
        patch as unknown as Record<string, unknown>,
      );
      if (changeDesc) {
        await logActivity({
          db: deps.db,
          tenantId: ctx.tenantId,
          userId: actorUserId,
          subject: `Company updated: ${updated.name}`,
          body: changeDesc,
          companyId: updated.id,
        });
        emitCrm(deps, "entity.updated", ctx.tenantId, {
          entityType: "crm_company",
          entityId: updated.id,
          changes: changeDesc,
        });
      }

      return { ok: true, result: { data: updated } };
    },
  };

  const del: Tool = {
    name: "companies.delete",
    description: "Delete a company.",
    inputs: z.object({
      id: z.string().uuid(),
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: { id: string; actorUserId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const [deleted] = await deps.db
        .delete(companies)
        .where(and(eq(companies.id, input.id), eq(companies.tenantId, ctx.tenantId)))
        .returning();

      if (!deleted) {
        return {
          ok: false,
          error: { code: "not_found", message: "Company not found", retryable: false },
        };
      }

      // companyId is null because the company row is gone — keeping
      // the entity name + id in the body so the deletion still shows
      // up in tenant-wide activity feeds.
      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: input.actorUserId,
        subject: `Company deleted: ${deleted.name}`,
        body: `Removed ${deleted.name} (${deleted.domain ?? "no domain"}). Id: ${deleted.id}`,
      });

      emitCrm(deps, "entity.deleted", ctx.tenantId, {
        entityType: "crm_company",
        entityId: deleted.id,
      });

      return { ok: true, result: { data: deleted } };
    },
  };

  return [list, get, create, update, del];
}
