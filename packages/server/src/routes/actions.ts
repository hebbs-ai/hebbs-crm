import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { CrmContext } from "../context.js";
import { getGmailClient, getCalendarClient } from "../google-client.js";

/**
 * Actions Queue routes — list & execute approved agent actions.
 *
 * Actions are stored as `tasks` rows with `origin_kind` ∈
 * (agent_action, human_todo, agent_blocked). The execute endpoint runs the
 * `proposed_params` payload through the appropriate CRM API based on the
 * payload's `kind` discriminator, then marks the task done.
 *
 * Phase 1 supports `kind: "log_activity"` only. Phase 3 adds reply,
 * schedule_meeting, etc.
 */
export function createActionRoutes(ctx: CrmContext) {
  const app = new Hono();

  // GET / — list actions for the current user (defaults to pending)
  // Query params:
  //   kind=agent_action|human_todo|agent_blocked
  //   status=todo|done|cancelled|all  (default: todo)
  //   entityType=contact|deal|company  + entityId=UUID  → filter via proposed_params
  //   limit, offset
  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const { kind, status = "todo", entityType, entityId, limit = "50", offset = "0" } = c.req.query();

    const filters: Array<ReturnType<typeof sql>> = [
      sql`tenant_id = ${tenantId}`,
      sql`origin_kind IN ('agent_action', 'human_todo', 'agent_blocked')`,
    ];
    if (status === "resolved") {
      filters.push(sql`status IN ('done', 'cancelled')`);
    } else if (status !== "all") {
      filters.push(sql`status = ${status}`);
    }
    if (userId) filters.push(sql`assignee_user_id = ${userId}::uuid`);
    if (kind) filters.push(sql`origin_kind = ${kind}`);
    if (entityType && entityId) {
      const key = entityType === "contact" ? "contactId" : entityType === "deal" ? "dealId" : entityType === "company" ? "companyId" : null;
      if (key) filters.push(sql`proposed_params->>${key} = ${entityId}`);
    }

    const where = filters.reduce((acc, f, i) => i === 0 ? f : sql`${acc} AND ${f}`);

    const rows = await ctx.db.execute(sql`
      SELECT id, title, description, status, priority, origin_kind as "originKind",
             assignee_user_id as "assigneeUserId", assignee_agent_id as "assigneeAgentId",
             parent_id as "parentId", proposed_params as "proposedParams",
             created_by_agent_id as "createdByAgentId",
             created_at as "createdAt", updated_at as "updatedAt", completed_at as "completedAt"
      FROM tasks
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `) as unknown as Array<Record<string, unknown>>;

    return c.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  });

  // GET /count — pending action count (sidebar badge or per-entity surfaces)
  // Supports entityType + entityId for "N pending for this contact" displays.
  app.get("/count", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const { entityType, entityId } = c.req.query();
    const filters = [
      sql`tenant_id = ${tenantId}`,
      sql`status = 'todo'`,
      sql`origin_kind IN ('agent_action', 'human_todo', 'agent_blocked')`,
    ];
    if (userId && !entityType) filters.push(sql`assignee_user_id = ${userId}::uuid`);
    if (entityType && entityId) {
      const key = entityType === "contact" ? "contactId" : entityType === "deal" ? "dealId" : entityType === "company" ? "companyId" : null;
      if (key) filters.push(sql`proposed_params->>${key} = ${entityId}`);
    }
    const where = filters.reduce((acc, f, i) => i === 0 ? f : sql`${acc} AND ${f}`);
    const rows = await ctx.db.execute(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE ${where}`) as unknown as Array<{ n: number }>;
    return c.json({ pending: rows[0]?.n ?? 0 });
  });

  // POST /:id/dismiss — mark action as cancelled without executing
  app.post("/:id/dismiss", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const id = c.req.param("id");
    await ctx.db.execute(sql`
      UPDATE tasks
      SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return c.json({ ok: true });
  });

  // POST /:id/complete — mark a human_todo as done (user ticks the checkbox)
  app.post("/:id/complete", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const id = c.req.param("id");
    await ctx.db.execute(sql`
      UPDATE tasks
      SET status = 'done', completed_at = now(), updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return c.json({ ok: true });
  });

  // POST /:id/execute — run the action's proposed_params via the appropriate executor
  // Optional body { params } overrides proposed_params (for Edit & run flow)
  app.post("/:id/execute", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const id = c.req.param("id");
    const overrideBody = await c.req.json().catch(() => ({})) as { params?: Record<string, unknown> };

    const taskRows = await ctx.db.execute(sql`
      SELECT id, origin_kind as "originKind", proposed_params as "proposedParams",
             parent_id as "parentId"
      FROM tasks
      WHERE id = ${id} AND tenant_id = ${tenantId}
      LIMIT 1
    `) as unknown as Array<{ originKind: string; proposedParams: Record<string, unknown> | null }>;

    const task = taskRows[0];
    if (!task) return c.json({ error: "Action not found" }, 404);
    if (task.originKind !== "agent_action") {
      return c.json({ error: `Cannot execute origin_kind=${task.originKind}` }, 400);
    }

    const params = { ...(task.proposedParams ?? {}), ...(overrideBody.params ?? {}) } as Record<string, unknown>;
    const kind = params.kind as string | undefined;

    let result: { ok: boolean; detail?: unknown; error?: string };
    try {
      result = await executeAction(ctx, tenantId, userId, kind, params);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (result.ok) {
      await ctx.db.execute(sql`
        UPDATE tasks
        SET status = 'done', completed_at = now(), updated_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
      return c.json({ ok: true, detail: result.detail });
    } else {
      return c.json({ ok: false, error: result.error ?? "Execution failed" }, 500);
    }
  });

  // GET /:id/comments — list comments on this action
  app.get("/:id/comments", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const id = c.req.param("id");
    const rows = await ctx.db.execute(sql`
      SELECT id, body, author_user_id as "authorUserId", author_agent_id as "authorAgentId",
             created_at as "createdAt"
      FROM task_comments
      WHERE task_id = ${id} AND tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `) as unknown as Array<Record<string, unknown>>;
    return c.json({ data: rows });
  });

  // POST /:id/comments — post a comment (wakes any agent assigned to this task
  // via the framework's comment_posted hook — important for agent_blocked tasks
  // where the user's reply unblocks the agent)
  app.post("/:id/comments", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const id = c.req.param("id");
    const body = await c.req.json() as { body?: string };
    if (!body.body?.trim()) return c.json({ error: "body required" }, 400);

    const { randomUUID } = await import("node:crypto");
    const cid = randomUUID();
    await ctx.db.execute(sql`
      INSERT INTO task_comments (id, task_id, tenant_id, body, author_user_id)
      VALUES (${cid}, ${id}, ${tenantId}, ${body.body}, ${userId ?? null}::uuid)
    `);

    // If this task is assigned to an agent (e.g., agent_blocked), wake it.
    const taskRows = await ctx.db.execute(sql`
      SELECT assignee_agent_id, origin_kind FROM tasks WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
    `) as unknown as Array<{ assignee_agent_id: string | null; origin_kind: string }>;
    const t = taskRows[0];
    if (t?.assignee_agent_id) {
      await ctx.agentEngine?.wake({
        tenantId, agentId: t.assignee_agent_id, taskId: id, reason: "comment_posted",
      }).catch(() => { /* best-effort */ });
    }

    return c.json({ ok: true, id: cid }, 201);
  });

  return app;
}

/**
 * Dispatch on the params.kind discriminator. Each kind is a CRM-domain
 * executor — log_activity in Phase 1, reply / schedule_meeting in Phase 3.
 *
 * To add a new kind: create a case here, type its expected params, and
 * teach agents about it via the relevant route's agentDocs export.
 */
async function executeAction(
  ctx: CrmContext,
  tenantId: string,
  userId: string | undefined,
  kind: string | undefined,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; detail?: unknown; error?: string }> {
  switch (kind) {
    case "log_activity": {
      const { type = "note", subject, body, contactId, dealId, companyId, occurredAt } = params as {
        type?: string; subject?: string; body?: string;
        contactId?: string; dealId?: string; companyId?: string; occurredAt?: string;
      };
      if (!subject) return { ok: false, error: "log_activity requires `subject`" };
      const { randomUUID } = await import("node:crypto");
      const id = randomUUID();
      await ctx.db.execute(sql`
        INSERT INTO crm_activities (
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
      // Reply to a Gmail thread via the inbox item the agent referenced.
      // params: { kind: "reply", inboxItemId, body }
      const { inboxItemId, body } = params as { inboxItemId?: string; body?: string };
      if (!inboxItemId) return { ok: false, error: "reply requires `inboxItemId`" };
      if (!body?.trim()) return { ok: false, error: "reply requires non-empty `body`" };

      const itemRows = await ctx.db.execute(sql`
        SELECT source, source_id, subject, "from", metadata
        FROM inbox_items
        WHERE id = ${inboxItemId} AND tenant_id = ${tenantId}
        LIMIT 1
      `) as unknown as Array<{ source: string; source_id: string; subject: string; from: string; metadata: Record<string, unknown> | null }>;
      const item = itemRows[0];
      if (!item) return { ok: false, error: "inbox item not found" };
      if (item.source !== "gmail") return { ok: false, error: "reply only supported for gmail items" };

      const cli = await getGmailClient(ctx.db, tenantId);
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
      // params: { kind: "schedule_meeting", summary, startTime, endTime, attendees?, description?, timeZone? }
      const { summary, startTime, endTime, attendees, description, timeZone } = params as {
        summary?: string; startTime?: string; endTime?: string;
        attendees?: string[]; description?: string; timeZone?: string;
      };
      if (!summary || !startTime || !endTime) {
        return { ok: false, error: "schedule_meeting requires summary, startTime, endTime" };
      }

      const cli = await getCalendarClient(ctx.db, tenantId);
      if (!cli.calendar) return { ok: false, error: cli.error };

      const r = await cli.calendar.executeAction("create_event", {
        summary, startTime, endTime,
        description: description ?? "",
        attendees: attendees ?? [],
        timeZone: timeZone ?? "UTC",
      });
      if (!r.success) return { ok: false, error: r.error ?? "Calendar create_event failed" };
      return { ok: true, detail: r.data };
    }

    // Phase 4+ may add: update_stage, send_calendar_invite, nudge, add_to_list

    default:
      return { ok: false, error: `Unknown action kind: ${kind ?? "(missing)"}` };
  }
}

export function agentDocs(url: string): string {
  const tid = "$BORINGOS_TENANT_ID";
  return `**Actions Queue** — list and resolve human-actionable items proposed by agents. You generally don't need to call these as an agent; the user clicks Approve in the UI. But you may call list/count to check what's already pending (idempotency).

\`\`\`
# List pending actions for a user (filter by origin_kind: agent_action | human_todo | agent_blocked)
curl -s "${url}/api/crm/actions?status=todo" -H "X-Tenant-Id: ${tid}"
# Pending count for badge / idempotency check
curl -s ${url}/api/crm/actions/count -H "X-Tenant-Id: ${tid}"
# Dismiss / complete / execute (used by the UI when the user clicks)
curl -s -X POST ${url}/api/crm/actions/ID/dismiss  -H "X-Tenant-Id: ${tid}"
curl -s -X POST ${url}/api/crm/actions/ID/complete -H "X-Tenant-Id: ${tid}"
curl -s -X POST ${url}/api/crm/actions/ID/execute  -H "X-Tenant-Id: ${tid}" -H "Content-Type: application/json" -d '{}'
\`\`\`

**To CREATE an action (the normal agent path):** use \`POST /api/agent/tasks\` (framework callback) with \`originKind: "agent_action"\`, \`assigneeUserId\`, \`parentId\`, and \`proposedParams: { kind: "...", ... }\`. Supported kinds:

- \`log_activity\` — params: \`{ type: "note|call|email|meeting|task", subject, body?, contactId?, dealId?, companyId?, occurredAt? }\`
- \`reply\` — Gmail thread reply. Params: \`{ inboxItemId, body }\`. Resolves recipient from the inbox item.
- \`schedule_meeting\` — Google Calendar event. Params: \`{ summary, startTime (ISO 8601), endTime (ISO 8601), attendees?: string[], description?, timeZone? }\``;
}
