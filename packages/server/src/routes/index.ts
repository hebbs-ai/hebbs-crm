import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createContactRoutes } from "./contacts.js";
import { createCompanyRoutes } from "./companies.js";
import { createDealRoutes } from "./deals.js";
import { createPipelineRoutes } from "./pipelines.js";
import { createActivityRoutes } from "./activities.js";
import { createTeamRoutes } from "./team.js";
import type { CrmContext } from "../context.js";

export function createCrmRoutes(ctx: CrmContext) {
  const app = new Hono();

  // Auth middleware — resolve session token to tenantId + userId
  app.use("/*", async (c, next) => {
    // Check for existing X-Tenant-Id (API key auth)
    const existingTenant = c.req.header("X-Tenant-Id");
    if (existingTenant) {
      return next();
    }

    // Session auth — resolve from Bearer token
    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!bearer) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const now = new Date();
    const result = await ctx.db.execute(sql`
      SELECT s.user_id, ut.tenant_id, ut.role
      FROM auth_sessions s
      JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${bearer}
        AND s.expires_at > ${now.toISOString()}
      LIMIT 1
    `);

    const rows = result as unknown as Array<{ user_id: string; tenant_id: string; role: string }>;
    if (!rows[0]) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    // Set headers so downstream routes can read them
    c.req.raw.headers.set("X-Tenant-Id", rows[0].tenant_id);
    c.req.raw.headers.set("X-User-Id", rows[0].user_id);
    c.req.raw.headers.set("X-User-Role", rows[0].role);
    return next();
  });

  app.route("/contacts", createContactRoutes(ctx));
  app.route("/companies", createCompanyRoutes(ctx));
  app.route("/deals", createDealRoutes(ctx));
  app.route("/pipelines", createPipelineRoutes(ctx));
  app.route("/activities", createActivityRoutes(ctx));

  // Team management (requires auth — handled by middleware above)
  app.route("/team", createTeamRoutes(ctx));

  return app;
}
