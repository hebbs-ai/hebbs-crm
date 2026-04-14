import { Hono } from "hono";
import { eq, and, ilike, or } from "drizzle-orm";
import { companies } from "../schema/companies.js";
import { logActivity } from "../activity-logger.js";
import type { CrmContext } from "../context.js";

export function createCompanyRoutes(ctx: CrmContext) {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const { limit = "50", offset = "0", search, ownerId } = c.req.query();

    const conditions = [eq(companies.tenantId, tenantId)];
    if (ownerId) conditions.push(eq(companies.ownerId, ownerId));
    if (search) {
      conditions.push(
        or(
          ilike(companies.name, `%${search}%`),
          ilike(companies.domain, `%${search}%`)
        )!
      );
    }

    const rows = await ctx.db
      .select()
      .from(companies)
      .where(and(...conditions))
      .limit(Number(limit))
      .offset(Number(offset));

    return c.json({ data: rows, total: rows.length, limit: Number(limit), offset: Number(offset) });
  });

  app.get("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const row = await ctx.db
      .select()
      .from(companies)
      .where(and(eq(companies.id, c.req.param("id")), eq(companies.tenantId, tenantId)))
      .limit(1);

    if (!row.length) return c.json({ error: "Not found" }, 404);
    return c.json({ data: row[0] });
  });

  app.post("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const ownerId = c.req.header("X-User-Id") ?? tenantId;
    const body = await c.req.json();
    const [created] = await ctx.db
      .insert(companies)
      .values({ ...body, tenantId, ownerId: body.ownerId ?? ownerId })
      .returning();

    logActivity({
      db: ctx.db, tenantId, userId: ownerId,
      subject: `Company created: ${created.name}`,
      companyId: created.id,
    });

    // Emit event for enrichment agent
    ctx.emitEvent?.("entity.created", tenantId, { entityType: "crm_company", entityId: created.id });

    return c.json({ data: created }, 201);
  });

  app.put("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const body = await c.req.json();
    const [updated] = await ctx.db
      .update(companies)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(companies.id, c.req.param("id")), eq(companies.tenantId, tenantId)))
      .returning();

    if (!updated) return c.json({ error: "Not found" }, 404);

    logActivity({
      db: ctx.db, tenantId, userId: userId ?? undefined,
      subject: `Company updated: ${updated.name}`,
      companyId: updated.id,
    });

    return c.json({ data: updated });
  });

  app.delete("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const [deleted] = await ctx.db
      .delete(companies)
      .where(and(eq(companies.id, c.req.param("id")), eq(companies.tenantId, tenantId)))
      .returning();

    if (!deleted) return c.json({ error: "Not found" }, 404);

    logActivity({
      db: ctx.db, tenantId, userId: userId ?? undefined,
      subject: `Company deleted: ${deleted.name}`,
    });

    return c.json({ data: deleted });
  });

  return app;
}
