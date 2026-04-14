import { Hono } from "hono";
import { eq, and, ilike, or } from "drizzle-orm";
import { contacts } from "../schema/contacts.js";
import { logActivity } from "../activity-logger.js";
import type { CrmContext } from "../context.js";

export function createContactRoutes(ctx: CrmContext) {
  const app = new Hono();

  // List contacts
  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const { limit = "50", offset = "0", search, companyId, ownerId } = c.req.query();

    const conditions = [eq(contacts.tenantId, tenantId)];
    if (companyId) conditions.push(eq(contacts.companyId, companyId));
    if (ownerId) conditions.push(eq(contacts.ownerId, ownerId));
    if (search) {
      conditions.push(
        or(
          ilike(contacts.firstName, `%${search}%`),
          ilike(contacts.lastName, `%${search}%`),
          ilike(contacts.email, `%${search}%`)
        )!
      );
    }

    const rows = await ctx.db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .limit(Number(limit))
      .offset(Number(offset));

    return c.json({ data: rows, total: rows.length, limit: Number(limit), offset: Number(offset) });
  });

  // Get contact by ID
  app.get("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const row = await ctx.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.tenantId, tenantId)))
      .limit(1);

    if (!row.length) return c.json({ error: "Not found" }, 404);
    return c.json({ data: row[0] });
  });

  // Create contact
  app.post("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const ownerId = c.req.header("X-User-Id") ?? tenantId;
    const body = await c.req.json();
    const [created] = await ctx.db
      .insert(contacts)
      .values({ ...body, tenantId, ownerId: body.ownerId ?? ownerId })
      .returning();

    logActivity({
      db: ctx.db, tenantId, userId: ownerId,
      subject: `Contact created: ${created.firstName} ${created.lastName ?? ""}`.trim(),
      contactId: created.id,
      companyId: created.companyId,
    });

    // Emit event for enrichment agent
    ctx.emitEvent?.("entity.created", tenantId, { entityType: "crm_contact", entityId: created.id });

    return c.json({ data: created }, 201);
  });

  // Update contact
  app.put("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const body = await c.req.json();
    const [updated] = await ctx.db
      .update(contacts)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.tenantId, tenantId)))
      .returning();

    if (!updated) return c.json({ error: "Not found" }, 404);

    logActivity({
      db: ctx.db, tenantId, userId: userId ?? undefined,
      subject: `Contact updated: ${updated.firstName} ${updated.lastName ?? ""}`.trim(),
      contactId: updated.id,
      companyId: updated.companyId,
    });

    return c.json({ data: updated });
  });

  // Delete contact
  app.delete("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const [deleted] = await ctx.db
      .delete(contacts)
      .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.tenantId, tenantId)))
      .returning();

    if (!deleted) return c.json({ error: "Not found" }, 404);

    logActivity({
      db: ctx.db, tenantId, userId: userId ?? undefined,
      subject: `Contact deleted: ${deleted.firstName} ${deleted.lastName ?? ""}`.trim(),
      companyId: deleted.companyId,
    });

    return c.json({ data: deleted });
  });

  return app;
}
