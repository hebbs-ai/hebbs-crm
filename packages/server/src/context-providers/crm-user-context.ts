import { sql } from "drizzle-orm";
import type { ContextProvider, ContextBuildEvent } from "@boringos/agent";

/**
 * Provides the copilot with real-time CRM stats for the current tenant.
 * This gives the copilot awareness of the user's actual data.
 */
export function createCrmUserContextProvider(getDb: () => unknown): ContextProvider {
  return {
    name: "crm-user-context",
    phase: "context",
    priority: 41,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      const db = getDb() as any;
      const tenantId = event.tenantId;

      try {
        // Get counts
        const [contacts, companies, deals, activities] = await Promise.all([
          db.execute(sql`SELECT count(*) as c FROM crm_contacts WHERE tenant_id = ${tenantId}`),
          db.execute(sql`SELECT count(*) as c FROM crm_companies WHERE tenant_id = ${tenantId}`),
          db.execute(sql`SELECT count(*) as c FROM crm_deals WHERE tenant_id = ${tenantId}`),
          db.execute(sql`SELECT count(*) as c FROM crm_activities WHERE tenant_id = ${tenantId}`),
        ]);

        // Get pipeline summary
        const pipelineSummary = await db.execute(sql`
          SELECT ps.name as stage, count(d.id) as deals, coalesce(sum(d.value), 0) as total_value
          FROM crm_pipeline_stages ps
          JOIN crm_pipelines p ON p.id = ps.pipeline_id AND p.tenant_id = ${tenantId}
          LEFT JOIN crm_deals d ON d.stage_id = ps.id AND d.tenant_id = ${tenantId}
          GROUP BY ps.name, ps.sort_order
          ORDER BY ps.sort_order
        `);

        // Get recent activities
        const recentActivities = await db.execute(sql`
          SELECT type, subject, occurred_at
          FROM crm_activities
          WHERE tenant_id = ${tenantId}
          ORDER BY occurred_at DESC
          LIMIT 5
        `);

        const contactCount = (contacts as any)[0]?.c ?? 0;
        const companyCount = (companies as any)[0]?.c ?? 0;
        const dealCount = (deals as any)[0]?.c ?? 0;
        const activityCount = (activities as any)[0]?.c ?? 0;

        let summary = `## Current CRM State\n\n`;
        summary += `- **${contactCount}** contacts\n`;
        summary += `- **${companyCount}** companies\n`;
        summary += `- **${dealCount}** deals\n`;
        summary += `- **${activityCount}** activities\n\n`;

        if ((pipelineSummary as any[]).length > 0) {
          summary += `### Pipeline\n\n`;
          summary += `| Stage | Deals | Value |\n|---|---|---|\n`;
          for (const row of pipelineSummary as any[]) {
            const value = Number(row.total_value) / 100;
            summary += `| ${row.stage} | ${row.deals} | $${value.toLocaleString()} |\n`;
          }
          summary += `\n`;
        }

        if ((recentActivities as any[]).length > 0) {
          summary += `### Recent Activity\n\n`;
          for (const row of recentActivities as any[]) {
            const date = new Date(row.occurred_at).toLocaleDateString();
            summary += `- [${row.type}] ${row.subject} (${date})\n`;
          }
        }

        return summary;
      } catch {
        return null;
      }
    },
  };
}
