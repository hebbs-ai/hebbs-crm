// CRM action-queue tools — list / count / dismiss / complete /
// execute / list_comments / post_comment.
//
// "Actions" are framework `tasks` rows whose `origin_kind` is one
// of {agent_action, human_todo, agent_blocked}. The `proposed_params`
// JSONB column carries a discriminated `kind` payload that
// `actions.execute` dispatches on.
//
// Dispatched at /api/tools/crm.actions.<name>. tenantId comes from
// the JWT context. We use raw SQL because `tasks` and
// `task_comments` are framework-owned (no Drizzle schema in this
// package).

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import { getGmailClient, getCalendarClient } from "../google-client.js";
import { emitCrm, type CrmDeps } from "./deps.js";

type EntityType = "contact" | "deal" | "company";

function entityKey(entityType: EntityType): "contactId" | "dealId" | "companyId" {
  if (entityType === "contact") return "contactId";
  if (entityType === "deal") return "dealId";
  return "companyId";
}

export function createActionTools(deps: CrmDeps): Tool[] {
  const list: Tool = {
    name: "actions.list",
    description:
      "List actions (framework tasks with origin_kind in {agent_action, human_todo, agent_blocked}) for the current tenant. Filter by kind, status (todo|done|cancelled|resolved|all, default todo), assignee user, and entity (entityType + entityId).",
    inputs: z.object({
      kind: z.enum(["agent_action", "human_todo", "agent_blocked"]).optional(),
      status: z.enum(["todo", "done", "cancelled", "resolved", "all"]).optional(),
      assigneeUserId: z.string().uuid().optional(),
      entityType: z.enum(["contact", "deal", "company"]).optional(),
      entityId: z.string().uuid().optional(),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    async handler(
      input: {
        kind?: "agent_action" | "human_todo" | "agent_blocked";
        status?: "todo" | "done" | "cancelled" | "resolved" | "all";
        assigneeUserId?: string;
        entityType?: EntityType;
        entityId?: string;
        limit?: number;
        offset?: number;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const status = input.status ?? "todo";
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;

      const filters: Array<ReturnType<typeof sql>> = [
        sql`tenant_id = ${ctx.tenantId}`,
        sql`origin_kind IN ('agent_action', 'human_todo', 'agent_blocked')`,
      ];
      if (status === "resolved") {
        filters.push(sql`status IN ('done', 'cancelled')`);
      } else if (status !== "all") {
        filters.push(sql`status = ${status}`);
      }
      if (input.assigneeUserId) {
        filters.push(sql`assignee_user_id = ${input.assigneeUserId}::uuid`);
      }
      if (input.kind) filters.push(sql`origin_kind = ${input.kind}`);
      if (input.entityType && input.entityId) {
        const key = entityKey(input.entityType);
        filters.push(sql`proposed_params->>${key} = ${input.entityId}`);
      }

      const where = filters.reduce((acc, f, i) => (i === 0 ? f : sql`${acc} AND ${f}`));

      const result = await deps.db.execute(sql`
        SELECT id, title, description, status, priority, origin_kind as "originKind",
               assignee_user_id as "assigneeUserId", assignee_agent_id as "assigneeAgentId",
               parent_id as "parentId", proposed_params as "proposedParams",
               created_by_agent_id as "createdByAgentId",
               created_at as "createdAt", updated_at as "updatedAt", completed_at as "completedAt"
        FROM tasks
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      const rows = result as unknown as Array<Record<string, unknown>>;

      return {
        ok: true,
        result: { data: rows, total: rows.length, limit, offset },
      };
    },
  };

  const countPending: Tool = {
    name: "actions.count_pending",
    description:
      "Count pending (status=todo) actions for the current tenant — used for sidebar badges and 'N pending for this entity' surfaces. Optionally scope by assignee user, or by entity (entityType + entityId).",
    inputs: z.object({
      assigneeUserId: z.string().uuid().optional(),
      entityType: z.enum(["contact", "deal", "company"]).optional(),
      entityId: z.string().uuid().optional(),
    }),
    async handler(
      input: {
        assigneeUserId?: string;
        entityType?: EntityType;
        entityId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const filters: Array<ReturnType<typeof sql>> = [
        sql`tenant_id = ${ctx.tenantId}`,
        sql`status = 'todo'`,
        sql`origin_kind IN ('agent_action', 'human_todo', 'agent_blocked')`,
      ];
      // Mirror v1: user scope only applies when not also scoping by entity.
      if (input.assigneeUserId && !input.entityType) {
        filters.push(sql`assignee_user_id = ${input.assigneeUserId}::uuid`);
      }
      if (input.entityType && input.entityId) {
        const key = entityKey(input.entityType);
        filters.push(sql`proposed_params->>${key} = ${input.entityId}`);
      }
      const where = filters.reduce((acc, f, i) => (i === 0 ? f : sql`${acc} AND ${f}`));
      const result = await deps.db.execute(
        sql`SELECT COUNT(*)::int AS n FROM tasks WHERE ${where}`,
      );
      const rows = result as unknown as Array<{ n: number }>;
      return { ok: true, result: { pending: rows[0]?.n ?? 0 } };
    },
  };

  const dismiss: Tool = {
    name: "actions.dismiss",
    description: "Mark an action as cancelled without executing it.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const found = await ensureActionInTenant(deps, input.id, ctx.tenantId);
      if (!found.ok) return found.error;

      await deps.db.execute(sql`
        UPDATE tasks
        SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE id = ${input.id} AND tenant_id = ${ctx.tenantId}
      `);
      return { ok: true, result: { id: input.id, status: "cancelled" } };
    },
  };

  const complete: Tool = {
    name: "actions.complete",
    description:
      "Mark a human_todo action as done (the user ticked the checkbox). Sets status=done and completed_at=now().",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const found = await ensureActionInTenant(deps, input.id, ctx.tenantId);
      if (!found.ok) return found.error;

      await deps.db.execute(sql`
        UPDATE tasks
        SET status = 'done', completed_at = now(), updated_at = now()
        WHERE id = ${input.id} AND tenant_id = ${ctx.tenantId}
      `);
      return { ok: true, result: { id: input.id, status: "done" } };
    },
  };

  const execute: Tool = {
    name: "actions.execute",
    description:
      "Execute an agent_action by dispatching its proposed_params.kind: 'log_activity' | 'reply' | 'schedule_meeting' | 'resume_workflow'. Optional `params` overrides proposed_params (Edit & Run flow). On success the action is marked done.",
    inputs: z.object({
      id: z.string().uuid(),
      params: z.record(z.unknown()).optional(),
      /** Attribution for logged activities; falls back to ctx.tenantId. */
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: { id: string; params?: Record<string, unknown>; actorUserId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const taskRows = (await deps.db.execute(sql`
        SELECT id, tenant_id as "tenantId", origin_kind as "originKind",
               proposed_params as "proposedParams"
        FROM tasks
        WHERE id = ${input.id}
        LIMIT 1
      `)) as unknown as Array<{
        tenantId: string;
        originKind: string;
        proposedParams: Record<string, unknown> | null;
      }>;
      const task = taskRows[0];
      if (!task) {
        return {
          ok: false,
          error: { code: "not_found", message: "Action not found", retryable: false },
        };
      }
      if (task.tenantId !== ctx.tenantId) {
        return {
          ok: false,
          error: {
            code: "permission_denied",
            message: "Action belongs to another tenant",
            retryable: false,
          },
        };
      }
      if (task.originKind !== "agent_action") {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: `Cannot execute origin_kind=${task.originKind}`,
            retryable: false,
          },
        };
      }

      const params = {
        ...(task.proposedParams ?? {}),
        ...(input.params ?? {}),
      } as Record<string, unknown>;
      const kind = params.kind as string | undefined;

      let dispatch: { ok: boolean; detail?: unknown; error?: string };
      try {
        dispatch = await executeAction(deps, ctx.tenantId, input.actorUserId, kind, params);
      } catch (err) {
        dispatch = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      if (!dispatch.ok) {
        // Surface bad/missing kind as invalid_input; everything else is upstream.
        const code =
          !kind || kind === "(missing)" || dispatch.error?.startsWith("Unknown action kind")
            ? "invalid_input"
            : "upstream_unavailable";
        return {
          ok: false,
          error: {
            code,
            message: dispatch.error ?? "Execution failed",
            retryable: code === "upstream_unavailable",
          },
        };
      }

      await deps.db.execute(sql`
        UPDATE tasks
        SET status = 'done', completed_at = now(), updated_at = now()
        WHERE id = ${input.id} AND tenant_id = ${ctx.tenantId}
      `);

      return { ok: true, result: { kind, ...(dispatch.detail as object | undefined) } };
    },
  };

  const listComments: Tool = {
    name: "actions.list_comments",
    description: "List comments on an action, oldest first.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const found = await ensureActionInTenant(deps, input.id, ctx.tenantId);
      if (!found.ok) return found.error;

      const result = await deps.db.execute(sql`
        SELECT id, body, author_user_id as "authorUserId", author_agent_id as "authorAgentId",
               created_at as "createdAt"
        FROM task_comments
        WHERE task_id = ${input.id} AND tenant_id = ${ctx.tenantId}
        ORDER BY created_at ASC
      `);
      const rows = result as unknown as Array<Record<string, unknown>>;
      return { ok: true, result: { data: rows } };
    },
  };

  const postComment: Tool = {
    name: "actions.post_comment",
    description:
      "Post a comment on an action. If called by an agent (ctx.agentId set), attributed to that agent; otherwise requires actorUserId. Emits crm 'comment.posted' event so the framework / subscribers can wake the assignee or creator agent (important for agent_blocked tasks where the user's reply unblocks the agent).",
    inputs: z.object({
      id: z.string().uuid(),
      body: z.string().min(1),
      /** Required when invoked outside an agent context. */
      actorUserId: z.string().uuid().optional(),
    }),
    async handler(
      input: { id: string; body: string; actorUserId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!input.body.trim()) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "body required", retryable: false },
        };
      }
      if (!ctx.agentId && !input.actorUserId) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: "actorUserId required when not invoked by an agent",
            retryable: false,
          },
        };
      }

      const found = await ensureActionInTenant(deps, input.id, ctx.tenantId);
      if (!found.ok) return found.error;

      const { randomUUID } = await import("node:crypto");
      const cid = randomUUID();
      await deps.db.execute(sql`
        INSERT INTO task_comments (id, task_id, tenant_id, body, author_user_id, author_agent_id)
        VALUES (
          ${cid}, ${input.id}, ${ctx.tenantId}, ${input.body},
          ${input.actorUserId ?? null}::uuid,
          ${ctx.agentId ?? null}::uuid
        )
      `);

      // Resolve target agent: assignee first, then creator.
      const taskRows = (await deps.db.execute(sql`
        SELECT assignee_agent_id as "assigneeAgentId",
               created_by_agent_id as "createdByAgentId",
               origin_kind as "originKind"
        FROM tasks WHERE id = ${input.id} AND tenant_id = ${ctx.tenantId} LIMIT 1
      `)) as unknown as Array<{
        assigneeAgentId: string | null;
        createdByAgentId: string | null;
        originKind: string;
      }>;
      const t = taskRows[0];
      const targetAgentId = t?.assigneeAgentId ?? t?.createdByAgentId ?? null;

      // Emit the event so the framework's wake-on-comment hook (or any
      // subscriber) can fan out. v2 doesn't expose an in-process
      // agentEngine.wake() here, so we surface the intent via the bus
      // and let upstream wire it to framework.agents.wake.
      emitCrm(deps, "comment.posted", ctx.tenantId, {
        commentId: cid,
        taskId: input.id,
        body: input.body,
        targetAgentId,
        originKind: t?.originKind ?? null,
        authorAgentId: ctx.agentId ?? null,
        authorUserId: input.actorUserId ?? null,
      });

      return { ok: true, result: { id: cid, targetAgentId } };
    },
  };

  return [list, countPending, dismiss, complete, execute, listComments, postComment];
}

/**
 * Read a tasks row scoped to the tenant. Returns ok or a typed
 * not_found / permission_denied error result the caller can return
 * directly.
 */
async function ensureActionInTenant(
  deps: CrmDeps,
  id: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: ToolResult & { ok: false } }> {
  const rows = (await deps.db.execute(sql`
    SELECT tenant_id as "tenantId" FROM tasks WHERE id = ${id} LIMIT 1
  `)) as unknown as Array<{ tenantId: string }>;
  if (!rows[0]) {
    return {
      ok: false,
      error: {
        ok: false,
        error: { code: "not_found", message: "Action not found", retryable: false },
      },
    };
  }
  if (rows[0].tenantId !== tenantId) {
    return {
      ok: false,
      error: {
        ok: false,
        error: {
          code: "permission_denied",
          message: "Action belongs to another tenant",
          retryable: false,
        },
      },
    };
  }
  return { ok: true };
}

/**
 * Dispatch on params.kind. Mirrors v1 routes/actions.ts logic.
 *
 * - log_activity: insert into crm__activities (note the double
 *   underscore — this package's actual table; v1 had a typo).
 * - reply: Gmail thread reply via the inbox item.
 * - schedule_meeting: Google Calendar event.
 * - resume_workflow: not supported in v2 tools (no workflow engine
 *   handle in CrmDeps); returns a clear error so the caller can
 *   route it through framework.workflow.resume instead.
 */
async function executeAction(
  deps: CrmDeps,
  tenantId: string,
  userId: string | undefined,
  kind: string | undefined,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; detail?: unknown; error?: string }> {
  switch (kind) {
    case "log_activity": {
      const {
        type = "note",
        subject,
        body,
        contactId,
        dealId,
        companyId,
        occurredAt,
      } = params as {
        type?: string;
        subject?: string;
        body?: string;
        contactId?: string;
        dealId?: string;
        companyId?: string;
        occurredAt?: string;
      };
      if (!subject) return { ok: false, error: "log_activity requires `subject`" };
      const { randomUUID } = await import("node:crypto");
      const id = randomUUID();
      await deps.db.execute(sql`
        INSERT INTO crm__activities (
          id, tenant_id, type, subject, body, contact_id, deal_id, company_id, user_id, occurred_at
        ) VALUES (
          ${id}, ${tenantId}, ${type}, ${subject}, ${body ?? null},
          ${contactId ?? null}, ${dealId ?? null}, ${companyId ?? null},
          ${userId ?? tenantId}, ${occurredAt ?? new Date().toISOString()}
        )
      `);
      return { ok: true, detail: { activityId: id } };
    }

    case "reply": {
      const { inboxItemId, body } = params as { inboxItemId?: string; body?: string };
      if (!inboxItemId) return { ok: false, error: "reply requires `inboxItemId`" };
      if (!body?.trim()) return { ok: false, error: "reply requires non-empty `body`" };

      const itemRows = (await deps.db.execute(sql`
        SELECT source, source_id, subject, "from", metadata
        FROM inbox_items
        WHERE id = ${inboxItemId} AND tenant_id = ${tenantId}
        LIMIT 1
      `)) as unknown as Array<{
        source: string;
        source_id: string;
        subject: string;
        from: string;
        metadata: Record<string, unknown> | null;
      }>;
      const item = itemRows[0];
      if (!item) return { ok: false, error: "inbox item not found" };
      if (item.source !== "gmail") {
        return { ok: false, error: "reply only supported for gmail items" };
      }

      const cli = await getGmailClient(deps.db, tenantId);
      if (!cli.gmail) return { ok: false, error: cli.error };

      const toEmail = item.from.match(/<([^>]+)>/)?.[1] ?? item.from;
      const threadId = (item.metadata?.threadId as string) ?? "";

      const r = await cli.gmail.executeAction("reply_email", {
        messageId: item.source_id,
        threadId,
        to: toEmail,
        subject: item.subject ?? "",
        body,
      });
      if (!r.success) return { ok: false, error: r.error ?? "Gmail reply failed" };
      return { ok: true, detail: { messageId: r.data?.id } };
    }

    case "schedule_meeting": {
      const { summary, startTime, endTime, attendees, description, timeZone } = params as {
        summary?: string;
        startTime?: string;
        endTime?: string;
        attendees?: string[];
        description?: string;
        timeZone?: string;
      };
      if (!summary || !startTime || !endTime) {
        return { ok: false, error: "schedule_meeting requires summary, startTime, endTime" };
      }

      const cli = await getCalendarClient(deps.db, tenantId);
      if (!cli.calendar) return { ok: false, error: cli.error };

      const r = await cli.calendar.executeAction("create_event", {
        summary,
        startTime,
        endTime,
        description: description ?? "",
        attendees: attendees ?? [],
        timeZone: timeZone ?? "UTC",
      });
      if (!r.success) {
        return { ok: false, error: r.error ?? "Calendar create_event failed" };
      }
      return { ok: true, detail: r.data };
    }

    case "resume_workflow": {
      // v1 had a direct ctx.workflowEngine handle. In v2 the
      // workflow engine is not part of CrmDeps — callers should
      // route this through the framework.workflow.resume tool.
      return {
        ok: false,
        error:
          "resume_workflow not supported by crm.actions.execute in v2; call framework.workflow.resume directly",
      };
    }

    default:
      return { ok: false, error: `Unknown action kind: ${kind ?? "(missing)"}` };
  }
}
