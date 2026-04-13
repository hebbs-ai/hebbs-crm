import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { invitations } from "../schema/invitations.js";
import { getTenantUsers, updateUserRole, removeUserFromTenant } from "../tenant.js";
import type { CrmContext } from "../context.js";

export function createTeamRoutes(ctx: CrmContext) {
  const app = new Hono();

  // GET /users — list users in tenant
  app.get("/users", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const users = await getTenantUsers(ctx.db, tenantId);
    return c.json({ data: users });
  });

  // PATCH /users/:userId/role — change role (admin only)
  app.patch("/users/:userId/role", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const role = c.req.header("X-User-Role");
    if (role !== "admin") return c.json({ error: "Admin only" }, 403);

    const body = await c.req.json() as { role: string };
    if (!body.role || !["admin", "staff"].includes(body.role)) {
      return c.json({ error: "role must be admin or staff" }, 400);
    }

    await updateUserRole(ctx.db, c.req.param("userId"), tenantId, body.role);
    return c.json({ ok: true });
  });

  // DELETE /users/:userId — remove user from tenant (admin only)
  app.delete("/users/:userId", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const role = c.req.header("X-User-Role");
    const currentUserId = c.req.header("X-User-Id");
    if (role !== "admin") return c.json({ error: "Admin only" }, 403);

    const targetUserId = c.req.param("userId");
    if (targetUserId === currentUserId) {
      return c.json({ error: "Cannot remove yourself" }, 400);
    }

    await removeUserFromTenant(ctx.db, targetUserId, tenantId);
    return c.json({ ok: true });
  });

  // GET /invitations — list pending invitations
  app.get("/invitations", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const rows = await ctx.db.select().from(invitations)
      .where(and(eq(invitations.tenantId, tenantId), eq(invitations.status, "pending")));
    return c.json({ data: rows });
  });

  // POST /invitations — create invitation (admin only)
  app.post("/invitations", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const role = c.req.header("X-User-Role");
    const userId = c.req.header("X-User-Id")!;
    if (role !== "admin") return c.json({ error: "Admin only" }, 403);

    const body = await c.req.json() as { email: string; role?: string };
    if (!body.email) return c.json({ error: "email required" }, 400);

    const inviteRole = body.role && ["admin", "staff"].includes(body.role) ? body.role : "staff";
    const code = randomUUID().replace(/-/g, "").slice(0, 16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [created] = await ctx.db.insert(invitations).values({
      tenantId,
      email: body.email.toLowerCase(),
      role: inviteRole,
      code,
      invitedBy: userId,
      expiresAt,
    }).returning();

    return c.json({ data: created, inviteLink: `/signup?invite=${code}` }, 201);
  });

  // DELETE /invitations/:id — revoke invitation (admin only)
  app.delete("/invitations/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const role = c.req.header("X-User-Role");
    if (role !== "admin") return c.json({ error: "Admin only" }, 403);

    await ctx.db.delete(invitations)
      .where(and(eq(invitations.id, c.req.param("id")), eq(invitations.tenantId, tenantId)));
    return c.json({ ok: true });
  });

  return app;
}
