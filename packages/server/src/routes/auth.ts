import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { randomUUID, createHmac } from "node:crypto";
import type { CrmContext } from "../context.js";
import { createTenantWithPipeline, linkUserToTenant, getUserTenants } from "../tenant.js";

export function createAuthRoutes(ctx: CrmContext) {
  const app = new Hono();
  const secret = process.env.AUTH_SECRET ?? "boringos-secret";

  function hashPassword(password: string): string {
    return createHmac("sha256", secret).update(password).digest("hex");
  }

  // POST /signup — create user + tenant (new org) or join via invite
  app.post("/signup", async (c) => {
    const body = await c.req.json() as {
      name: string;
      email: string;
      password: string;
      orgName?: string;        // new org signup
      inviteCode?: string;     // join existing org
    };

    if (!body.email || !body.password || !body.name) {
      return c.json({ error: "name, email, and password required" }, 400);
    }

    // Check if user already exists
    const existing = await ctx.db.execute(sql`SELECT id FROM auth_users WHERE email = ${body.email} LIMIT 1`);
    if ((existing as unknown as unknown[]).length > 0) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const userId = randomUUID();
    const passwordHash = hashPassword(body.password);

    // Create user
    await ctx.db.execute(sql`
      INSERT INTO auth_users (id, name, email, email_verified)
      VALUES (${userId}, ${body.name}, ${body.email}, false)
    `);
    await ctx.db.execute(sql`
      INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password)
      VALUES (${randomUUID()}, ${userId}, ${userId}, 'credential', ${passwordHash})
    `);

    if (body.inviteCode) {
      // Join existing tenant via invite
      const invite = await ctx.db.execute(sql`
        SELECT tenant_id, role, email FROM crm_invitations
        WHERE code = ${body.inviteCode} AND status = 'pending' AND expires_at > now()
        LIMIT 1
      `);
      const inviteRows = invite as unknown as Array<{ tenant_id: string; role: string; email: string }>;
      if (!inviteRows[0]) {
        return c.json({ error: "Invalid or expired invitation" }, 400);
      }
      if (inviteRows[0].email.toLowerCase() !== body.email.toLowerCase()) {
        return c.json({ error: "Email does not match invitation" }, 400);
      }

      await linkUserToTenant(ctx.db, userId, inviteRows[0].tenant_id, inviteRows[0].role);

      // Mark invite as accepted
      await ctx.db.execute(sql`
        UPDATE crm_invitations SET status = 'accepted', accepted_at = now()
        WHERE code = ${body.inviteCode}
      `);
    } else {
      // New org — create tenant
      const orgName = body.orgName || `${body.name}'s Team`;
      const tenantId = await createTenantWithPipeline(ctx.db, orgName);
      await linkUserToTenant(ctx.db, userId, tenantId, "admin");
    }

    // Create session
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await ctx.db.execute(sql`
      INSERT INTO auth_sessions (id, user_id, token, expires_at)
      VALUES (${randomUUID()}, ${userId}, ${sessionToken}, ${expiresAt.toISOString()})
    `);

    return c.json({ userId, token: sessionToken }, 201);
  });

  // POST /login
  app.post("/login", async (c) => {
    const body = await c.req.json() as { email: string; password: string };
    if (!body.email || !body.password) {
      return c.json({ error: "email and password required" }, 400);
    }

    const passwordHash = hashPassword(body.password);
    const result = await ctx.db.execute(sql`
      SELECT u.id, u.name, u.email
      FROM auth_users u
      JOIN auth_accounts a ON a.user_id = u.id AND a.provider_id = 'credential'
      WHERE u.email = ${body.email} AND a.password = ${passwordHash}
      LIMIT 1
    `);
    const rows = result as unknown as Array<{ id: string; name: string; email: string }>;
    if (!rows[0]) return c.json({ error: "Invalid credentials" }, 401);

    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await ctx.db.execute(sql`
      INSERT INTO auth_sessions (id, user_id, token, expires_at)
      VALUES (${randomUUID()}, ${rows[0].id}, ${sessionToken}, ${expiresAt.toISOString()})
    `);

    // Get user's tenants
    const tenants = await getUserTenants(ctx.db, rows[0].id);

    return c.json({
      userId: rows[0].id,
      token: sessionToken,
      name: rows[0].name,
      email: rows[0].email,
      tenants,
    });
  });

  // GET /me
  app.get("/me", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const result = await ctx.db.execute(sql`
      SELECT u.id, u.name, u.email
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `);
    const rows = result as unknown as Array<{ id: string; name: string; email: string }>;
    if (!rows[0]) return c.json({ error: "Invalid or expired session" }, 401);

    const tenants = await getUserTenants(ctx.db, rows[0].id);

    // Use tenantId from header if specified (tenant switch), otherwise first tenant
    const requestedTenant = c.req.header("X-Tenant-Id");
    const activeTenant = tenants.find((t) => t.tenantId === requestedTenant) ?? tenants[0];

    return c.json({
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      tenantId: activeTenant?.tenantId ?? null,
      tenantName: activeTenant?.tenantName ?? null,
      role: activeTenant?.role ?? null,
      tenants,
    });
  });

  // POST /logout
  app.post("/logout", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (token) {
      await ctx.db.execute(sql`DELETE FROM auth_sessions WHERE token = ${token}`);
    }
    return c.json({ ok: true });
  });

  return app;
}
