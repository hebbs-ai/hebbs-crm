// CRM routines tool — activate the cron-driven sync routines that
// lifecycle.ts seeded as `paused`. Called from the "Activate sync
// routines on Google connect" workflow once the user finishes
// OAuth, and also exposed as a manual escape hatch.
//
// Lives in CRM (not framework) because the routines target CRM-
// owned workflows; we identify them by title prefix instead of
// reaching across module boundaries.

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import type { CrmDeps } from "./deps.js";

export function createRoutineTools(deps: CrmDeps): Tool[] {
  const activateSync: Tool = {
    name: "routines.activate_sync",
    description:
      "Flip the CRM's paused Gmail/Calendar sync routines to active. Called automatically after the Google connector is connected; safe to invoke manually if a routine remains paused. Returns the count of routines activated.",
    inputs: z.object({}),
    async handler(
      _input: Record<string, never>,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Match by title prefix instead of workflow id so this works
      // even after a re-install (workflow ids change on re-seed).
      const result = (await deps.db.execute(sql`
        UPDATE routines
        SET status = 'active', updated_at = now()
        WHERE tenant_id = ${ctx.tenantId}
          AND status = 'paused'
          AND (
            title ILIKE 'Email Sync%'
            OR title ILIKE 'Calendar Check%'
          )
        RETURNING id, title
      `)) as unknown as Array<{ id: string; title: string }>;

      return {
        ok: true,
        result: {
          activated: result.length,
          routines: result.map((r) => r.title),
        },
      };
    },
  };

  return [activateSync];
}
