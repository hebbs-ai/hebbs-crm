// CRM activity tools — list / get / create / update / delete / timeline.
// Dispatched at /api/tools/crm.activities.<name>. tenantId comes
// from the JWT context; userId comes from the input on create
// (the shell passes the calling user; agents pass an explicit user).

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { eq, and, desc } from "drizzle-orm";
import { activities } from "../schema/activities.js";
import type { ActivityType } from "@boringos-crm/shared";
import { type CrmDeps } from "./deps.js";

const activityTypeEnum = z.enum([
  "call",
  "email",
  "meeting",
  "note",
  "task",
]);

export function createActivityTools(deps: CrmDeps): Tool[] {
  const list: Tool = {
    name: "activities.list",
    description:
      "List activities for the current tenant. Supports filters on contactId, dealId, companyId, and type.",
    inputs: z.object({
      contactId: z.string().uuid().optional(),
      dealId: z.string().uuid().optional(),
      companyId: z.string().uuid().optional(),
      type: activityTypeEnum.optional(),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    async handler(
      input: {
        contactId?: string;
        dealId?: string;
        companyId?: string;
        type?: ActivityType;
        limit?: number;
        offset?: number;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const conds = [eq(activities.tenantId, ctx.tenantId)];
      if (input.contactId) conds.push(eq(activities.contactId, input.contactId));
      if (input.dealId) conds.push(eq(activities.dealId, input.dealId));
      if (input.companyId) conds.push(eq(activities.companyId, input.companyId));
      if (input.type) conds.push(eq(activities.type, input.type));

      const rows = await deps.db
        .select()
        .from(activities)
        .where(and(...conds))
        .orderBy(desc(activities.occurredAt))
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
    name: "activities.get",
    description: "Fetch one activity by id.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const row = await deps.db
        .select()
        .from(activities)
        .where(and(eq(activities.id, input.id), eq(activities.tenantId, ctx.tenantId)))
        .limit(1);
      if (!row.length) {
        return {
          ok: false,
          error: { code: "not_found", message: "Activity not found", retryable: false },
        };
      }
      return { ok: true, result: { data: row[0] } };
    },
  };

  const create: Tool = {
    name: "activities.create",
    description:
      "Create an activity. userId defaults to the calling user (must be supplied by the shell); agents must pass it explicitly.",
    inputs: z.object({
      userId: z.string().uuid(),
      type: activityTypeEnum,
      subject: z.string().min(1),
      body: z.string().optional(),
      contactId: z.string().uuid().optional(),
      dealId: z.string().uuid().optional(),
      companyId: z.string().uuid().optional(),
      occurredAt: z.union([z.string(), z.date()]).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: {
        userId: string;
        type: ActivityType;
        subject: string;
        body?: string;
        contactId?: string;
        dealId?: string;
        companyId?: string;
        occurredAt?: string | Date;
        metadata?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const [created] = await deps.db
        .insert(activities)
        .values({
          tenantId: ctx.tenantId,
          userId: input.userId,
          type: input.type,
          subject: input.subject,
          body: input.body ?? null,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          companyId: input.companyId ?? null,
          ...(input.occurredAt
            ? { occurredAt: new Date(input.occurredAt) }
            : {}),
          metadata: input.metadata ?? {},
        })
        .returning();

      return { ok: true, result: { data: created } };
    },
  };

  const update: Tool = {
    name: "activities.update",
    description: "Update an activity. Pass only the fields to change.",
    inputs: z.object({
      id: z.string().uuid(),
      subject: z.string().optional(),
      body: z.string().nullable().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    async handler(
      input: {
        id: string;
        subject?: string;
        body?: string | null;
        metadata?: Record<string, unknown>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const { id, ...patch } = input;
      const [updated] = await deps.db
        .update(activities)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(activities.id, id), eq(activities.tenantId, ctx.tenantId)))
        .returning();

      if (!updated) {
        return {
          ok: false,
          error: { code: "not_found", message: "Activity not found", retryable: false },
        };
      }

      return { ok: true, result: { data: updated } };
    },
  };

  const del: Tool = {
    name: "activities.delete",
    description: "Delete an activity.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const [deleted] = await deps.db
        .delete(activities)
        .where(and(eq(activities.id, input.id), eq(activities.tenantId, ctx.tenantId)))
        .returning();

      if (!deleted) {
        return {
          ok: false,
          error: { code: "not_found", message: "Activity not found", retryable: false },
        };
      }

      return { ok: true, result: { data: deleted } };
    },
  };

  const timeline: Tool = {
    name: "activities.timeline",
    description:
      "Fetch the activity timeline for a contact, ordered by occurredAt DESC. Returns TimelineEntry[] with activity + agentNote (agentNote is null for now).",
    inputs: z.object({ contactId: z.string().uuid() }),
    async handler(
      input: { contactId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = await deps.db
        .select()
        .from(activities)
        .where(
          and(
            eq(activities.tenantId, ctx.tenantId),
            eq(activities.contactId, input.contactId),
          ),
        )
        .orderBy(desc(activities.occurredAt));

      const data = rows.map((activity) => ({ activity, agentNote: null }));
      return { ok: true, result: { data } };
    },
  };

  return [list, get, create, update, del, timeline];
}
