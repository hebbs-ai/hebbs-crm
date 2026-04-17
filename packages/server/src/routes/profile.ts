import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { CrmContext } from "../context.js";

const PROFILE_FIELDS = [
  "company_name",
  "company_description",
  "company_products",
  "company_icp",
  "company_differentiators",
  "company_competitors",
  "company_methodology",
  "company_tone",
] as const;

/**
 * Company profile routes — the base context for all agents.
 */
export function createProfileRoutes(ctx: CrmContext) {
  const app = new Hono();

  // GET / — get company profile
  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const result = await ctx.db.execute(sql`
      SELECT key, value FROM tenant_settings
      WHERE tenant_id = ${tenantId} AND key LIKE 'company_%'
    `);
    const rows = result as unknown as Array<{ key: string; value: string | null }>;
    const profile: Record<string, string | null> = {};
    for (const field of PROFILE_FIELDS) profile[field] = null;
    for (const r of rows) profile[r.key] = r.value;

    return c.json({ profile });
  });

  // PUT / — save company profile
  app.put("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const body = await c.req.json() as Record<string, string | null>;

    for (const field of PROFILE_FIELDS) {
      const value = body[field] ?? null;
      const existing = await ctx.db.execute(sql`
        SELECT id FROM tenant_settings WHERE tenant_id = ${tenantId} AND key = ${field} LIMIT 1
      `);
      const rows = existing as unknown as Array<{ id: string }>;

      if (rows[0]) {
        await ctx.db.execute(sql`
          UPDATE tenant_settings SET value = ${value}, updated_at = now() WHERE id = ${rows[0].id}
        `);
      } else if (value) {
        const { randomUUID } = await import("node:crypto");
        await ctx.db.execute(sql`
          INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES (${randomUUID()}, ${tenantId}, ${field}, ${value})
        `);
      }
    }

    return c.json({ ok: true });
  });

  return app;
}

export function agentDocs(url: string): string {
  const tid = "$BORINGOS_TENANT_ID";
  return `**Company Profile** — the org's self-description (company_name, company_description, company_products, company_icp, company_differentiators, company_competitors, company_methodology, company_tone). This is the base context injected into every agent run, so you usually already have it. Fetch directly if you need the raw values.

\`\`\`
curl -s ${url}/api/crm/profile -H "X-Tenant-Id: ${tid}"
\`\`\``;
}
