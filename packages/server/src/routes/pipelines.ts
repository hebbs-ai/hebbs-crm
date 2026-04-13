import { Hono } from "hono";
import { eq, and, asc, sum, count, sql } from "drizzle-orm";
import { pipelines, pipelineStages } from "../schema/pipelines.js";
import { deals } from "../schema/deals.js";
import type { CrmContext } from "../context.js";

export function createPipelineRoutes(ctx: CrmContext) {
  const app = new Hono();

  // List pipelines
  app.get("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const rows = await ctx.db
      .select()
      .from(pipelines)
      .where(eq(pipelines.tenantId, tenantId));

    return c.json({ data: rows });
  });

  // Get pipeline with stages
  app.get("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const pipelineId = c.req.param("id");

    const [pipeline] = await ctx.db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)))
      .limit(1);

    if (!pipeline) return c.json({ error: "Not found" }, 404);

    const stages = await ctx.db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
      .orderBy(asc(pipelineStages.sortOrder));

    return c.json({ data: { ...pipeline, stages } });
  });

  // Create pipeline
  app.post("/", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const body = await c.req.json();
    const { stages: stageInput, ...pipelineData } = body;

    const [created] = await ctx.db
      .insert(pipelines)
      .values({ ...pipelineData, tenantId })
      .returning();

    if (stageInput?.length) {
      await ctx.db.insert(pipelineStages).values(
        stageInput.map((s: any, i: number) => ({
          ...s,
          pipelineId: created.id,
          sortOrder: s.sortOrder ?? i,
        }))
      );
    }

    return c.json({ data: created }, 201);
  });

  // Update pipeline
  app.put("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const body = await c.req.json();
    const [updated] = await ctx.db
      .update(pipelines)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(pipelines.id, c.req.param("id")), eq(pipelines.tenantId, tenantId)))
      .returning();

    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json({ data: updated });
  });

  // Delete pipeline
  app.delete("/:id", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const [deleted] = await ctx.db
      .delete(pipelines)
      .where(and(eq(pipelines.id, c.req.param("id")), eq(pipelines.tenantId, tenantId)))
      .returning();

    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ data: deleted });
  });

  // Pipeline forecast
  app.get("/:id/forecast", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id")!;
    const pipelineId = c.req.param("id");

    const stages = await ctx.db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
      .orderBy(asc(pipelineStages.sortOrder));

    const dealsByStage = await ctx.db
      .select({
        stageId: deals.stageId,
        dealCount: count(deals.id),
        totalValue: sum(deals.value),
      })
      .from(deals)
      .where(and(eq(deals.tenantId, tenantId), eq(deals.pipelineId, pipelineId)))
      .groupBy(deals.stageId);

    const dealMap = new Map(dealsByStage.map((d) => [d.stageId, d]));

    const forecastStages = stages.map((stage) => {
      const d = dealMap.get(stage.id);
      const totalValue = Number(d?.totalValue ?? 0);
      return {
        stageId: stage.id,
        stageName: stage.name,
        dealCount: Number(d?.dealCount ?? 0),
        totalValue,
        weightedValue: Math.round(totalValue * (stage.probability / 100)),
        probability: stage.probability,
      };
    });

    const totalWeightedValue = forecastStages.reduce(
      (sum, s) => sum + s.weightedValue,
      0
    );

    return c.json({
      data: {
        pipelineId,
        totalWeightedValue,
        stages: forecastStages,
      },
    });
  });

  // Stage CRUD
  app.post("/:id/stages", async (c) => {
    const body = await c.req.json();
    const [created] = await ctx.db
      .insert(pipelineStages)
      .values({ ...body, pipelineId: c.req.param("id") })
      .returning();

    return c.json({ data: created }, 201);
  });

  app.put("/:id/stages/:stageId", async (c) => {
    const body = await c.req.json();
    const [updated] = await ctx.db
      .update(pipelineStages)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(pipelineStages.id, c.req.param("stageId")))
      .returning();

    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json({ data: updated });
  });

  app.delete("/:id/stages/:stageId", async (c) => {
    const [deleted] = await ctx.db
      .delete(pipelineStages)
      .where(eq(pipelineStages.id, c.req.param("stageId")))
      .returning();

    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ data: deleted });
  });

  return app;
}
