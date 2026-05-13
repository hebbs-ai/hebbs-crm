// CRM deal tools — list / get / create / update / delete.
// Dispatched at /api/tools/crm.deals.<name>. tenantId comes from the
// JWT context; ownerId comes from the input (the shell passes the
// calling user; agents pass an explicit owner).

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { eq, and, ilike, asc, sql } from "drizzle-orm";
import { deals } from "../schema/deals.js";
import { pipelines, pipelineStages } from "../schema/pipelines.js";
import { logActivity, describeDealChanges } from "../activity-logger.js";
import { emitCrm, type CrmDeps } from "./deps.js";

export function createDealTools(deps: CrmDeps): Tool[] {
  const list: Tool = {
    name: "deals.list",
    description:
      "List deals for the current tenant. Supports search on title, plus filters on pipelineId, stageId, and ownerId.",
    inputs: z.object({
      search: z.string().optional(),
      pipelineId: z.string().uuid().optional(),
      stageId: z.string().uuid().optional(),
      ownerId: z.string().uuid().optional(),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    async handler(
      input: {
        search?: string;
        pipelineId?: string;
        stageId?: string;
        ownerId?: string;
        limit?: number;
        offset?: number;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const conds = [eq(deals.tenantId, ctx.tenantId)];
      if (input.pipelineId) conds.push(eq(deals.pipelineId, input.pipelineId));
      if (input.stageId) conds.push(eq(deals.stageId, input.stageId));
      if (input.ownerId) conds.push(eq(deals.ownerId, input.ownerId));
      if (input.search) conds.push(ilike(deals.title, `%${input.search}%`));

      const where = and(...conds);
      const [rows, totalRow] = await Promise.all([
        deps.db
          .select()
          .from(deals)
          .where(where)
          .limit(input.limit ?? 50)
          .offset(input.offset ?? 0),
        deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(deals)
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
    name: "deals.get",
    description: "Fetch one deal by id.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const row = await deps.db
        .select()
        .from(deals)
        .where(and(eq(deals.id, input.id), eq(deals.tenantId, ctx.tenantId)))
        .limit(1);
      if (!row.length) {
        return {
          ok: false,
          error: { code: "not_found", message: "Deal not found", retryable: false },
        };
      }
      return { ok: true, result: { data: row[0] } };
    },
  };

  const create: Tool = {
    name: "deals.create",
    description:
      "Create a deal. value is in cents (integer). ownerId, pipelineId, stageId default to the tenant's defaults if not supplied (single-user tenants).",
    inputs: z.object({
      ownerId: z.string().uuid().optional(),
      title: z.string().min(1),
      value: z.number().int().nonnegative().optional(),
      currency: z.string().optional(),
      pipelineId: z.string().uuid().optional(),
      stageId: z.string().uuid().optional(),
      probability: z.number().min(0).max(100).optional(),
      expectedCloseDate: z.string().optional(),
      contactId: z.string().uuid().optional(),
      companyId: z.string().uuid().optional(),
      lostReason: z.string().optional(),
      customFields: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: {
        ownerId?: string;
        title: string;
        value?: number;
        currency?: string;
        pipelineId?: string;
        stageId?: string;
        probability?: number;
        expectedCloseDate?: string;
        contactId?: string;
        companyId?: string;
        lostReason?: string;
        customFields?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Resolve pipeline/stage defaults if not given (typical for the
      // copilot or for single-pipeline tenants).
      let pipelineId = input.pipelineId;
      let stageId = input.stageId;
      if (!pipelineId || !stageId) {
        const [defaultPipeline] = await deps.db
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.isDefault, true)))
          .limit(1);
        if (!defaultPipeline) {
          return {
            ok: false,
            error: { code: "not_found", message: "No default pipeline; pass pipelineId explicitly", retryable: false },
          };
        }
        pipelineId = pipelineId ?? defaultPipeline.id;
        if (!stageId) {
          const [firstStage] = await deps.db
            .select({ id: pipelineStages.id })
            .from(pipelineStages)
            .where(and(eq(pipelineStages.pipelineId, pipelineId), eq(pipelineStages.type, "open")))
            .orderBy(asc(pipelineStages.sortOrder))
            .limit(1);
          if (!firstStage) {
            return {
              ok: false,
              error: { code: "not_found", message: "No open stages on default pipeline", retryable: false },
            };
          }
          stageId = firstStage.id;
        }
      }
      const ownerId = input.ownerId ?? ctx.tenantId;
      const [created] = await deps.db
        .insert(deals)
        .values({
          tenantId: ctx.tenantId,
          ownerId,
          title: input.title,
          value: input.value ?? 0,
          currency: input.currency ?? "USD",
          pipelineId,
          stageId,
          probability: input.probability ?? null,
          expectedCloseDate: input.expectedCloseDate
            ? new Date(input.expectedCloseDate)
            : null,
          contactId: input.contactId ?? null,
          companyId: input.companyId ?? null,
          lostReason: input.lostReason ?? null,
          customFields: input.customFields ?? {},
        })
        .returning();

      const valueFmt = `$${(created.value / 100).toLocaleString("en-US")}`;
      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: ownerId,
        subject: `Deal created: ${created.title} (${valueFmt})`,
        dealId: created.id,
        contactId: created.contactId,
        companyId: created.companyId,
      });

      // Wakes the deal-analyst agent's workflow without waiting for
      // the next daily batch run.
      emitCrm(deps, "entity.created", ctx.tenantId, {
        entityType: "crm_deal",
        entityId: created.id,
      });

      return { ok: true, result: { data: created } };
    },
  };

  const update: Tool = {
    name: "deals.update",
    description:
      "Update a deal. Pass only the fields to change. value is in cents (integer).",
    inputs: z.object({
      id: z.string().uuid(),
      title: z.string().optional(),
      value: z.number().int().nonnegative().optional(),
      currency: z.string().optional(),
      pipelineId: z.string().uuid().optional(),
      stageId: z.string().uuid().optional(),
      probability: z.number().min(0).max(100).nullable().optional(),
      expectedCloseDate: z.string().nullable().optional(),
      contactId: z.string().uuid().nullable().optional(),
      companyId: z.string().uuid().nullable().optional(),
      lostReason: z.string().nullable().optional(),
      customFields: z.record(z.unknown()).optional(),
      /** If supplied, attributed in the activity log. */
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: {
        id: string;
        title?: string;
        value?: number;
        currency?: string;
        pipelineId?: string;
        stageId?: string;
        probability?: number | null;
        expectedCloseDate?: string | null;
        contactId?: string | null;
        companyId?: string | null;
        lostReason?: string | null;
        customFields?: Record<string, unknown>;
        actorUserId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const { id, actorUserId, expectedCloseDate, ...rest } = input;

      // Fetch old row for change detection.
      const [old] = await deps.db
        .select()
        .from(deals)
        .where(and(eq(deals.id, id), eq(deals.tenantId, ctx.tenantId)))
        .limit(1);
      if (!old) {
        return {
          ok: false,
          error: { code: "not_found", message: "Deal not found", retryable: false },
        };
      }

      const patch: Record<string, unknown> = { ...rest };
      if (expectedCloseDate !== undefined) {
        patch.expectedCloseDate = expectedCloseDate
          ? new Date(expectedCloseDate)
          : null;
      }

      const [updated] = await deps.db
        .update(deals)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(deals.id, id), eq(deals.tenantId, ctx.tenantId)))
        .returning();

      // Build stage name map for readable change descriptions.
      const stageRows = await deps.db
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineId, updated.pipelineId));
      const stageNames = new Map(stageRows.map((s) => [s.id, s.name]));

      const changeDesc = describeDealChanges(
        old as unknown as Record<string, unknown>,
        patch,
        stageNames,
      );
      if (changeDesc) {
        await logActivity({
          db: deps.db,
          tenantId: ctx.tenantId,
          userId: actorUserId,
          subject: `Deal updated: ${updated.title} — ${changeDesc}`,
          body: changeDesc,
          dealId: updated.id,
          contactId: updated.contactId,
          companyId: updated.companyId,
        });

        // Wakes the deal-analyst agent for change-driven analysis.
        emitCrm(deps, "deal.updated", ctx.tenantId, {
          dealId: updated.id,
          changes: changeDesc,
        });
      }

      return { ok: true, result: { data: updated } };
    },
  };

  const del: Tool = {
    name: "deals.delete",
    description: "Delete a deal.",
    inputs: z.object({
      id: z.string().uuid(),
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: { id: string; actorUserId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const [deleted] = await deps.db
        .delete(deals)
        .where(and(eq(deals.id, input.id), eq(deals.tenantId, ctx.tenantId)))
        .returning();

      if (!deleted) {
        return {
          ok: false,
          error: { code: "not_found", message: "Deal not found", retryable: false },
        };
      }

      await logActivity({
        db: deps.db,
        tenantId: ctx.tenantId,
        userId: input.actorUserId,
        subject: `Deal deleted: ${deleted.title}`,
        contactId: deleted.contactId,
        companyId: deleted.companyId,
      });

      return { ok: true, result: { data: deleted } };
    },
  };

  return [list, get, create, update, del];
}
