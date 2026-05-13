// CRM calendar tools — single-purpose helper that lists upcoming
// Google Calendar events for the tenant and creates one meeting-prep
// task per event. Dispatched at /api/tools/crm.calendar.<verb>.
//
// Why this lives in CRM (not framework): the v1 "Calendar Check" and
// "Prep upcoming meetings" workflows used block kinds the v2
// workflow engine doesn't execute (`connector-action`,
// `emit-event`, `for-each`, `create-task`, `wake-agent`). Rather
// than re-encode that as a brittle 4-block DAG, we collapse the
// whole flow into a single tool the cron-driven routine calls.
//
// The framework's `tasks.create` tool already auto-wakes the
// assigneeAgentId, so once we create the meeting-prep task the
// agent picks it up on its own.

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import { getCalendarClient } from "../google-client.js";
import type { CrmDeps } from "./deps.js";

interface CalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
}

export function createCalendarTools(deps: CrmDeps): Tool[] {
  const syncPrep: Tool = {
    name: "calendar.sync_prep",
    description:
      "List upcoming Google Calendar events for the tenant and create one meeting-prep task per event (deduped by event id). The framework's task creator auto-wakes the meeting-prep agent. Returns { eventsFetched, tasksCreated, tasksSkipped }.",
    inputs: z.object({
      maxResults: z.number().int().positive().max(50).optional(),
      lookaheadHours: z.number().int().positive().max(168).optional(),
    }),
    async handler(
      input: { maxResults?: number; lookaheadHours?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const db = deps.db;
      const maxResults = input.maxResults ?? 10;
      const lookaheadHours = input.lookaheadHours ?? 24;

      const client = await getCalendarClient(db, ctx.tenantId);
      if (!client.calendar) {
        // No Google connector → soft no-op so the cron routine still
        // succeeds. Matches `inbox.sync`'s shape.
        return {
          ok: true,
          result: {
            eventsFetched: 0,
            tasksCreated: 0,
            tasksSkipped: 0,
            reason: client.error ?? "Google Calendar not connected",
          },
        };
      }

      const timeMin = new Date().toISOString();
      const timeMax = new Date(
        Date.now() + lookaheadHours * 60 * 60 * 1000,
      ).toISOString();
      const result = await client.calendar.executeAction("list_events", {
        maxResults,
        timeMin,
        timeMax,
      });

      if (!result.success || !result.data) {
        return {
          ok: false,
          error: {
            code: "upstream_unavailable",
            message: result.error ?? "Failed to fetch calendar events",
            retryable: true,
          },
        };
      }

      const events = ((result.data as { events?: CalendarEvent[] }).events ??
        []) as CalendarEvent[];

      // Find the meeting-prep agent that lifecycle seeded.
      const agentRows = (await db.execute(sql`
        SELECT id FROM agents
        WHERE tenant_id = ${ctx.tenantId} AND role = 'meeting-prep'
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      const meetingPrepAgentId = agentRows[0]?.id ?? null;

      let tasksCreated = 0;
      let tasksSkipped = 0;

      for (const ev of events) {
        if (!ev.id || !ev.summary) continue;

        // Idempotency: dedupe by origin_id == event id. The
        // meeting-prep agent marks its task done, so re-running this
        // tool doesn't re-spawn already-handled prep.
        const existing = (await db.execute(sql`
          SELECT id FROM tasks
          WHERE tenant_id = ${ctx.tenantId}
            AND origin_kind = 'agent-meeting-prep'
            AND origin_id = ${ev.id}
          LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        if (existing.length > 0) {
          tasksSkipped++;
          continue;
        }

        const startIso = ev.start?.dateTime ?? ev.start?.date ?? "TBD";
        const attendeesText = (ev.attendees ?? [])
          .map((a) => a.email ?? a.displayName)
          .filter(Boolean)
          .join(", ");

        const description = [
          `Meeting: ${ev.summary}`,
          `Event ID: ${ev.id}`,
          `Start: ${startIso}`,
          ev.location ? `Location: ${ev.location}` : null,
          attendeesText ? `Attendees: ${attendeesText}` : null,
          ev.description ? `\nDescription:\n${ev.description}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        // Direct insert: we own the table and need to control the
        // origin_id / assigneeAgentId combo precisely. The framework's
        // task watcher reacts to the row and wakes the assignee
        // agent.
        await db
          .execute(sql`
            INSERT INTO tasks (
              id, tenant_id, title, description, status, priority,
              origin_kind, origin_id, assignee_agent_id, created_at, updated_at
            ) VALUES (
              ${crypto.randomUUID()}, ${ctx.tenantId},
              ${`Meeting prep: ${ev.summary}`},
              ${description}, 'todo', 'medium',
              'agent-meeting-prep', ${ev.id},
              ${meetingPrepAgentId},
              now(), now()
            )
          `)
          .catch(() => {});
        tasksCreated++;
      }

      return {
        ok: true,
        result: {
          eventsFetched: events.length,
          tasksCreated,
          tasksSkipped,
        },
      };
    },
  };

  return [syncPrep];
}
