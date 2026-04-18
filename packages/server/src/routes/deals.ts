import { Hono } from "hono";
import { eq, and, ilike, sum, count } from "drizzle-orm";
import { deals } from "../schema/deals.js";
import { pipelineStages } from "../schema/pipelines.js";
import { logActivity, describeDealChanges } from "../activity-logger.js";
import type { CrmContext } from "../context.js";

export function createDealRoutes(ctx: CrmContext) {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const { limit = "50", offset = "0", pipelineId, stageId, ownerId, search } = c.req.query();

    const conditions = [eq(deals.tenantId, tenantId)];
    if (pipelineId) conditions.push(eq(deals.pipelineId, pipelineId));
    if (stageId) conditions.push(eq(deals.stageId, stageId));
    if (ownerId) conditions.push(eq(deals.ownerId, ownerId));
    if (search) conditions.push(ilike(deals.title, `%${search}%`));

    const rows = await ctx.db
      .select()
      .from(deals)
      .where(and(...conditions))
      .limit(Number(limit))
      .offset(Number(offset));

    return c.json({ data: rows, total: rows.length, limit: Number(limit), offset: Number(offset) });
  });

  app.get("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const row = await ctx.db
      .select()
      .from(deals)
      .where(and(eq(deals.id, c.req.param("id")), eq(deals.tenantId, tenantId)))
      .limit(1);

    if (!row.length) return c.json({ error: "Not found" }, 404);
    return c.json({ data: row[0] });
  });

  app.post("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const ownerId = c.req.header("X-User-Id") ?? tenantId;
    const body = await c.req.json();
    if (body.expectedCloseDate) body.expectedCloseDate = new Date(body.expectedCloseDate);
    const [created] = await ctx.db
      .insert(deals)
      .values({ ...body, tenantId, ownerId: body.ownerId ?? ownerId })
      .returning();

    const valueFmt = `$${(created.value / 100).toLocaleString("en-US")}`;
    logActivity({
      db: ctx.db, tenantId, userId: ownerId,
      subject: `Deal created: ${created.title} (${valueFmt})`,
      dealId: created.id,
      contactId: created.contactId,
      companyId: created.companyId,
    });

    // Emit event so the Deal Analyst can produce intelligence for this deal
    // without waiting for the next daily batch run.
    ctx.emitEvent?.("entity.created", tenantId, { entityType: "crm_deal", entityId: created.id });

    return c.json({ data: created }, 201);
  });

  app.put("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const body = await c.req.json();
    if (body.expectedCloseDate) body.expectedCloseDate = new Date(body.expectedCloseDate);

    // Get old deal for change detection
    const [old] = await ctx.db.select().from(deals)
      .where(and(eq(deals.id, c.req.param("id")), eq(deals.tenantId, tenantId)))
      .limit(1);
    if (!old) return c.json({ error: "Not found" }, 404);

    const [updated] = await ctx.db
      .update(deals)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(deals.id, c.req.param("id")), eq(deals.tenantId, tenantId)))
      .returning();

    // Build stage name map for readable change descriptions
    const stageRows = await ctx.db.select().from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, updated.pipelineId));
    const stageNames = new Map(stageRows.map((s) => [s.id, s.name]));

    const changeDesc = describeDealChanges(old as unknown as Record<string, unknown>, body, stageNames);
    if (changeDesc) {
      logActivity({
        db: ctx.db, tenantId, userId: userId ?? undefined,
        subject: `Deal updated: ${updated.title}`,
        body: changeDesc,
        dealId: updated.id,
        contactId: updated.contactId,
        companyId: updated.companyId,
      });
    }

    return c.json({ data: updated });
  });

  app.delete("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const userId = c.req.header("X-User-Id");
    const [deleted] = await ctx.db
      .delete(deals)
      .where(and(eq(deals.id, c.req.param("id")), eq(deals.tenantId, tenantId)))
      .returning();

    if (!deleted) return c.json({ error: "Not found" }, 404);

    logActivity({
      db: ctx.db, tenantId, userId: userId ?? undefined,
      subject: `Deal deleted: ${deleted.title}`,
      contactId: deleted.contactId,
      companyId: deleted.companyId,
    });

    return c.json({ data: deleted });
  });

  return app;
}

export function agentDocs(url: string): string {
  const tid = "$BORINGOS_TENANT_ID";
  return `**Deals** — sales opportunities. Value is stored in cents ($50,000 = 5000000). Fields: id, title, value, currency, pipelineId, stageId, probability, expectedCloseDate, contactId, companyId, lostReason, customFields.

\`\`\`
curl -s ${url}/api/crm/deals?pipelineId=ID&stageId=ID&search=X -H "X-Tenant-Id: ${tid}"
curl -s ${url}/api/crm/deals/ID -H "X-Tenant-Id: ${tid}"
curl -s -X POST ${url}/api/crm/deals -H "X-Tenant-Id: ${tid}" -H "Content-Type: application/json" \\
  -d '{"title":"...","value":5000000,"pipelineId":"...","stageId":"...","contactId":"...","companyId":"..."}'
curl -s -X PUT ${url}/api/crm/deals/ID -H "X-Tenant-Id: ${tid}" -H "Content-Type: application/json" \\
  -d '{"stageId":"NEW_STAGE_ID","probability":75}'
curl -s -X DELETE ${url}/api/crm/deals/ID -H "X-Tenant-Id: ${tid}"
\`\`\``;
}
