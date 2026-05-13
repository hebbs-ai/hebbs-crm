// CRM maintenance — admin-triggered cleanup tasks.
//
// Dispatched at /api/tools/crm.maintenance.*. The single supported
// `start` verb creates a task assigned to the crm-maintenance agent,
// which then drives the human-in-the-loop cleanup flow (scan ->
// post candidates -> wait for "yes"/"no" comment -> delete).
//
// Why this lives in its own file:
//   - clear permission boundary (start is admin-only)
//   - keeps leads.ts focused on lead-shape tools

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { type CrmDeps } from "./deps.js";

export function createMaintenanceTools(deps: CrmDeps): Tool[] {
  const start: Tool = {
    name: "maintenance.start",
    description:
      "Create a maintenance task assigned to the crm-maintenance agent. The agent then scans for noise, posts the candidate list as a task comment, and waits for the admin to reply 'yes' / 'no' / 'yes but skip X'. Currently supports kind='purge_review'.",
    inputs: z.object({
      kind: z.enum(["purge_review"]).default("purge_review"),
    }),
    async handler(
      input: { kind: "purge_review" },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Find the crm-maintenance agent. Seeded by lifecycle.ts.
      const agentRows = (await deps.db.execute(sql`
        SELECT id FROM agents
        WHERE tenant_id = ${ctx.tenantId} AND role = 'crm-maintenance'
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (!agentRows[0]) {
        return {
          ok: false,
          error: {
            code: "not_found",
            message:
              "The crm-maintenance agent isn't seeded for this tenant. Re-install the CRM module so the agent is created.",
            retryable: false,
          },
        };
      }
      const agentId = agentRows[0].id;

      const taskId = randomUUID();
      const title =
        input.kind === "purge_review"
          ? "CRM inbox cleanup review"
          : `CRM maintenance: ${input.kind}`;
      const description =
        "Scan for auto-created contacts/companies/deals that look like noise (newsletters, bot senders, all-noise triage). The maintenance agent will post the candidate list as a comment and wait for your reply. Reply 'yes' to delete everything listed, 'no' to cancel, or 'yes but skip <pattern>' to delete a filtered subset.";

      await deps.db.execute(sql`
        INSERT INTO tasks (
          id, tenant_id, title, description, status, priority,
          origin_kind, assignee_agent_id, created_by_user_id, metadata, created_at, updated_at
        ) VALUES (
          ${taskId}, ${ctx.tenantId}, ${title}, ${description},
          'todo', 'low', 'agent-maintenance', ${agentId},
          ${ctx.wakeOwnerUserId ?? null}, ${JSON.stringify({
            kind: input.kind,
          })}::jsonb, now(), now()
        )
      `);

      return {
        ok: true,
        result: {
          taskId,
          agentId,
          kind: input.kind,
          taskUrl: `/actions/${taskId}`,
        },
      };
    },
  };

  return [start];
}
