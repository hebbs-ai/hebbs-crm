import { sql } from "drizzle-orm";
import type { ContextProvider, ContextBuildEvent } from "@boringos/agent";

/**
 * Injects the company profile into every agent's context.
 * This is the base context that guides all agent behavior —
 * what the company does, sells, who they target, how they communicate.
 */
export function createCompanyProfileProvider(getDb: () => unknown): ContextProvider {
  return {
    name: "crm-company-profile",
    phase: "system",
    priority: 35, // Before other CRM providers — this is foundational

    async provide(event: ContextBuildEvent): Promise<string | null> {
      const db = getDb() as any;
      if (!db) return null;

      try {
        const result = await db.execute(sql`
          SELECT key, value FROM tenant_settings
          WHERE tenant_id = ${event.tenantId} AND key LIKE 'company_%'
        `);
        const rows = result as unknown as Array<{ key: string; value: string | null }>;
        const profile: Record<string, string> = {};
        for (const r of rows) {
          if (r.value) profile[r.key] = r.value;
        }

        // Only inject if at least name or description is set
        if (!profile.company_name && !profile.company_description) return null;

        let md = `## Company Profile\n\n`;
        md += `You work for **${profile.company_name ?? "this company"}**.\n\n`;

        if (profile.company_description) {
          md += `**What we do:** ${profile.company_description}\n\n`;
        }
        if (profile.company_products) {
          md += `**Products/Services:** ${profile.company_products}\n\n`;
        }
        if (profile.company_icp) {
          md += `**Ideal customer:** ${profile.company_icp}\n\n`;
        }
        if (profile.company_differentiators) {
          md += `**Key differentiators:** ${profile.company_differentiators}\n\n`;
        }
        if (profile.company_competitors) {
          md += `**Competitors:** ${profile.company_competitors}\n\n`;
        }
        if (profile.company_methodology) {
          md += `**Sales methodology:** ${profile.company_methodology}\n\n`;
        }
        if (profile.company_tone) {
          md += `**Tone & voice:** ${profile.company_tone}\n\n`;
        }

        md += `Use this context to guide your analysis, communication, and recommendations. When drafting emails, use the specified tone. When scoring leads, consider the ideal customer profile. When discussing competitors, use the positioning above.`;

        return md;
      } catch {
        return null;
      }
    },
  };
}
