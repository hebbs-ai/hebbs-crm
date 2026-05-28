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
import { logActivity } from "../activity-logger.js";
import {
  resolveContactByEmail,
  resolveInboxItemEntities,
} from "../inbox-resolve.js";
import { promoteContactToDeal } from "./contacts.js";
import { emitCrm, type CrmDeps } from "./deps.js";

const ALLOWED_ACTIVITY_TYPES = new Set(["call", "email", "meeting", "note", "task"]);

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

      const [result, totalResult] = await Promise.all([
        deps.db.execute(sql`
          SELECT id, title, description, status, priority, origin_kind as "originKind",
                 assignee_user_id as "assigneeUserId", assignee_agent_id as "assigneeAgentId",
                 parent_id as "parentId", proposed_params as "proposedParams",
                 created_by_agent_id as "createdByAgentId",
                 created_at as "createdAt", updated_at as "updatedAt", completed_at as "completedAt"
          FROM tasks
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
        deps.db.execute(sql`SELECT count(*)::int AS n FROM tasks WHERE ${where}`),
      ]);
      const rows = result as unknown as Array<Record<string, unknown>>;
      const totalRows = totalResult as unknown as Array<{ n: number }>;

      return {
        ok: true,
        result: {
          data: rows,
          total: totalRows[0]?.n ?? rows.length,
          limit,
          offset,
        },
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
      "Execute an agent_action by dispatching its proposed_params.kind: 'log_activity' | 'reply' | 'schedule_meeting' | 'create_deal' | 'resume_workflow'. 'create_deal' needs `contactId` (optional `title`, `inboxItemId`) and adds the contact to the pipeline. Optional `params` overrides proposed_params (Edit & Run flow). On success the action is marked done.",
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
        SELECT id, title, tenant_id as "tenantId", origin_kind as "originKind",
               proposed_params as "proposedParams"
        FROM tasks
        WHERE id = ${input.id}
        LIMIT 1
      `)) as unknown as Array<{
        title: string;
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
        dispatch = await executeAction(deps, {
          tenantId: ctx.tenantId,
          userId: input.actorUserId,
          kind,
          params,
          taskTitle: task.title ?? null,
        });
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

interface ExecOpts {
  tenantId: string;
  userId: string | undefined;
  kind: string | undefined;
  params: Record<string, unknown>;
  /** Used as default `subject` for log_activity when the agent omitted one. */
  taskTitle: string | null;
}

/**
 * Dispatch on params.kind. Mirrors v1 routes/actions.ts logic with one
 * crucial fix: every successful `reply` / `schedule_meeting` also writes
 * a typed `crm__activities` row linked to the right entities, so the
 * Contact/Deal/Company timelines stay in sync.
 */
async function executeAction(
  deps: CrmDeps,
  opts: ExecOpts,
): Promise<{ ok: boolean; detail?: unknown; error?: string }> {
  const { tenantId, userId, kind, params, taskTitle } = opts;
  switch (kind) {
    case "log_activity": {
      const {
        type: rawType,
        subject: rawSubject,
        body,
        contactId,
        dealId,
        companyId,
      } = params as {
        type?: string;
        subject?: string;
        body?: string;
        contactId?: string;
        dealId?: string;
        companyId?: string;
      };
      const type = ALLOWED_ACTIVITY_TYPES.has(rawType ?? "")
        ? (rawType as "call" | "email" | "meeting" | "note" | "task")
        : "note";
      // Don't reject when the agent omitted `subject` — fall back to the
      // task title (it carries the agent's intent), then to a static
      // default. v1's hard "requires subject" error was a frequent cause
      // of stuck `agent_action` rows on the queue.
      const subject = (rawSubject?.trim() || taskTitle?.trim() || "Activity").slice(0, 500);
      await logActivity({
        db: deps.db,
        tenantId,
        userId,
        type,
        subject,
        body,
        contactId,
        dealId,
        companyId,
      });
      return { ok: true, detail: { logged: true, type, subject } };
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

      const cli = await getGmailClient(deps);
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

      // Mirror inbox.reply: log an email activity linked to the right
      // contact/deal/company so the timeline updates.
      const linked = await resolveInboxItemEntities(deps.db, tenantId, inboxItemId);
      await logActivity({
        db: deps.db,
        tenantId,
        userId,
        type: "email",
        subject: `Replied: ${item.subject ?? "(no subject)"}`,
        body,
        contactId: linked.contactId,
        dealId: linked.dealId,
        companyId: linked.companyId,
      });
      emitCrm(deps, "inbox.reply_sent", tenantId, {
        itemId: inboxItemId,
        to: toEmail,
        messageId: (r.data as { id?: string } | undefined)?.id,
        contactId: linked.contactId,
        dealId: linked.dealId,
        companyId: linked.companyId,
      });
      return {
        ok: true,
        detail: {
          messageId: (r.data as { id?: string } | undefined)?.id,
          contactId: linked.contactId,
          dealId: linked.dealId,
          companyId: linked.companyId,
        },
      };
    }

    case "schedule_meeting": {
      const {
        summary,
        startTime,
        endTime,
        attendees,
        description,
        timeZone,
        contactId,
        dealId,
        companyId,
      } = params as {
        summary?: string;
        startTime?: string;
        endTime?: string;
        attendees?: string[];
        description?: string;
        timeZone?: string;
        contactId?: string;
        dealId?: string;
        companyId?: string;
      };
      if (!summary || !startTime || !endTime) {
        return { ok: false, error: "schedule_meeting requires summary, startTime, endTime" };
      }

      const cli = await getCalendarClient(deps);
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

      // Try to resolve entities for the activity link. Caller-provided
      // ids win; otherwise look up the first attendee email.
      let linkedContact = contactId ?? null;
      let linkedDeal = dealId ?? null;
      let linkedCompany = companyId ?? null;
      if (!linkedContact && attendees?.length) {
        const resolved = await resolveContactByEmail(deps.db, tenantId, attendees[0]);
        linkedContact = resolved.contactId;
        linkedDeal = linkedDeal ?? resolved.dealId;
        linkedCompany = linkedCompany ?? resolved.companyId;
      }
      await logActivity({
        db: deps.db,
        tenantId,
        userId,
        type: "meeting",
        subject: `Scheduled: ${summary}`,
        body: description,
        contactId: linkedContact,
        dealId: linkedDeal,
        companyId: linkedCompany,
      });
      return { ok: true, detail: r.data };
    }

    case "resume_workflow": {
      // The framework explicitly removed wait-for-human workflow resume
      // (see boringos-framework admin-routes /workflow-runs/:id/resume).
      // Agents should use an `agent_action` task + comment to unblock
      // themselves instead.
      return {
        ok: false,
        error:
          "resume_workflow is no longer supported. Use a comment on an agent_action task instead so the assignee agent wakes via crm.comment.posted.",
      };
    }

    case "create_deal": {
      // Optional "add to pipeline" — the email-lens proposes this only
      // when it extracted genuine deal context. Creates a stub deal in
      // stage 1 (idempotent: no-op if the contact already has an open deal).
      const { contactId, title, inboxItemId } = params as {
        contactId?: string;
        title?: string;
        inboxItemId?: string;
      };
      if (!contactId) return { ok: false, error: "create_deal requires `contactId`" };
      const res = await promoteContactToDeal(deps, tenantId, {
        contactId,
        source: "agent_action",
        title,
        itemId: inboxItemId ?? null,
      });
      if (!res.ok) return { ok: false, error: res.error?.message ?? "create_deal failed" };
      return { ok: true, detail: res.result };
    }

    default:
      return { ok: false, error: `Unknown action kind: ${kind ?? "(missing)"}` };
  }
}
