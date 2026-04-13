import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { activities } from "../schema/activities.js";
import type { CrmContext } from "../context.js";

export function createActivityRoutes(ctx: CrmContext) {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const { limit = "50", offset = "0", contactId, dealId, companyId, type } = c.req.query();

    const conditions = [eq(activities.tenantId, tenantId)];
    if (contactId) conditions.push(eq(activities.contactId, contactId));
    if (dealId) conditions.push(eq(activities.dealId, dealId));
    if (companyId) conditions.push(eq(activities.companyId, companyId));
    if (type) conditions.push(eq(activities.type, type as any));

    const rows = await ctx.db
      .select()
      .from(activities)
      .where(and(...conditions))
      .orderBy(desc(activities.occurredAt))
      .limit(Number(limit))
      .offset(Number(offset));

    return c.json({ data: rows, total: rows.length, limit: Number(limit), offset: Number(offset) });
  });

  app.get("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const row = await ctx.db
      .select()
      .from(activities)
      .where(and(eq(activities.id, c.req.param("id")), eq(activities.tenantId, tenantId)))
      .limit(1);

    if (!row.length) return c.json({ error: "Not found" }, 404);
    return c.json({ data: row[0] });
  });

  app.post("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const body = await c.req.json();
    if (body.occurredAt) body.occurredAt = new Date(body.occurredAt);
    const [created] = await ctx.db
      .insert(activities)
      .values({ ...body, tenantId, userId: body.userId ?? userId })
      .returning();

    return c.json({ data: created }, 201);
  });

  app.put("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const body = await c.req.json();
    const [updated] = await ctx.db
      .update(activities)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(activities.id, c.req.param("id")), eq(activities.tenantId, tenantId)))
      .returning();

    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json({ data: updated });
  });

  app.delete("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const [deleted] = await ctx.db
      .delete(activities)
      .where(and(eq(activities.id, c.req.param("id")), eq(activities.tenantId, tenantId)))
      .returning();

    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ data: deleted });
  });

  // Contact timeline
  app.get("/timeline/:contactId", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const contactId = c.req.param("contactId");

    const rows = await ctx.db
      .select()
      .from(activities)
      .where(and(eq(activities.tenantId, tenantId), eq(activities.contactId, contactId)))
      .orderBy(desc(activities.occurredAt));

    return c.json({ data: rows });
  });

  return app;
}
