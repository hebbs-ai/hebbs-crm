// CRM pipeline tools — list / get / create / update / delete pipelines,
// stage CRUD, and a weighted-value forecast over open stages.
// Dispatched at /api/tools/crm.pipelines.<name>. tenantId comes from
// the JWT context.

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { eq, and, asc, count, sum } from "drizzle-orm";
import { pipelines, pipelineStages } from "../schema/pipelines.js";
import { deals } from "../schema/deals.js";
import { type CrmDeps } from "./deps.js";

const stageTypeSchema = z.enum(["open", "won", "lost"]);

export function createPipelineTools(deps: CrmDeps): Tool[] {
  const list: Tool = {
    name: "pipelines.list",
    description: "List all sales pipelines for the current tenant.",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const rows = await deps.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.tenantId, ctx.tenantId));
      return { ok: true, result: { data: rows } };
    },
  };

  const get: Tool = {
    name: "pipelines.get",
    description:
      "Fetch one pipeline by id, including its stages ordered by sortOrder.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const [pipeline] = await deps.db
        .select()
        .from(pipelines)
        .where(and(eq(pipelines.id, input.id), eq(pipelines.tenantId, ctx.tenantId)))
        .limit(1);

      if (!pipeline) {
        return {
          ok: false,
          error: { code: "not_found", message: "Pipeline not found", retryable: false },
        };
      }

      const stages = await deps.db
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineId, pipeline.id))
        .orderBy(asc(pipelineStages.sortOrder));

      return { ok: true, result: { data: { ...pipeline, stages } } };
    },
  };

  const create: Tool = {
    name: "pipelines.create",
    description:
      "Create a pipeline, optionally seeding it with an initial set of stages. Each stage gets sortOrder defaulted to its array index when not supplied.",
    inputs: z.object({
      name: z.string().min(1),
      isDefault: z.boolean().optional(),
      stages: z
        .array(
          z.object({
            name: z.string().min(1),
            sortOrder: z.number().int().nonnegative().optional(),
            probability: z.number().min(0).max(100).optional(),
            type: stageTypeSchema.optional(),
          }),
        )
        .optional(),
    }),
    async handler(
      input: {
        name: string;
        isDefault?: boolean;
        stages?: Array<{
          name: string;
          sortOrder?: number;
          probability?: number;
          type?: "open" | "won" | "lost";
        }>;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const [created] = await deps.db
        .insert(pipelines)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          isDefault: input.isDefault ?? false,
        })
        .returning();

      if (input.stages?.length) {
        await deps.db.insert(pipelineStages).values(
          input.stages.map((s, i) => ({
            pipelineId: created.id,
            name: s.name,
            sortOrder: s.sortOrder ?? i,
            probability: s.probability ?? 0,
            type: s.type ?? "open",
          })),
        );
      }

      return { ok: true, result: { data: created } };
    },
  };

  const update: Tool = {
    name: "pipelines.update",
    description: "Update a pipeline's name or isDefault flag.",
    inputs: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      isDefault: z.boolean().optional(),
    }),
    async handler(
      input: { id: string; name?: string; isDefault?: boolean },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const { id, ...patch } = input;
      const [updated] = await deps.db
        .update(pipelines)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, ctx.tenantId)))
        .returning();

      if (!updated) {
        return {
          ok: false,
          error: { code: "not_found", message: "Pipeline not found", retryable: false },
        };
      }

      return { ok: true, result: { data: updated } };
    },
  };

  const del: Tool = {
    name: "pipelines.delete",
    description: "Delete a pipeline.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      const [deleted] = await deps.db
        .delete(pipelines)
        .where(and(eq(pipelines.id, input.id), eq(pipelines.tenantId, ctx.tenantId)))
        .returning();

      if (!deleted) {
        return {
          ok: false,
          error: { code: "not_found", message: "Pipeline not found", retryable: false },
        };
      }

      return { ok: true, result: { data: deleted } };
    },
  };

  const forecast: Tool = {
    name: "pipelines.forecast",
    description:
      "Weighted-value forecast for a pipeline. Groups open deals by stage and weights each bucket by the stage's probability. Closed (won/lost) stages are excluded.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(
      input: { id: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const [pipeline] = await deps.db
        .select()
        .from(pipelines)
        .where(
          and(
            eq(pipelines.id, input.id),
            eq(pipelines.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      if (!pipeline) {
        return {
          ok: false,
          error: { code: "not_found", message: "Pipeline not found", retryable: false },
        };
      }

      const openStages = await deps.db
        .select()
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.pipelineId, input.id),
            eq(pipelineStages.type, "open"),
          ),
        )
        .orderBy(asc(pipelineStages.sortOrder));

      const dealsByStage = await deps.db
        .select({
          stageId: deals.stageId,
          dealCount: count(deals.id),
          totalValue: sum(deals.value),
        })
        .from(deals)
        .where(
          and(
            eq(deals.tenantId, ctx.tenantId),
            eq(deals.pipelineId, input.id),
          ),
        )
        .groupBy(deals.stageId);

      const dealMap = new Map(dealsByStage.map((d) => [d.stageId, d]));

      const forecastStages = openStages.map((stage) => {
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
        (acc, s) => acc + s.weightedValue,
        0,
      );

      return {
        ok: true,
        result: {
          data: {
            pipelineId: pipeline.id,
            pipelineName: pipeline.name,
            totalWeightedValue,
            stages: forecastStages,
          },
        },
      };
    },
  };

  const createStage: Tool = {
    name: "pipelines.create_stage",
    description:
      "Add a stage to a pipeline. type defaults to 'open'; probability defaults to 0; sortOrder defaults to 0.",
    inputs: z.object({
      pipelineId: z.string().uuid(),
      name: z.string().min(1),
      sortOrder: z.number().int().nonnegative().optional(),
      probability: z.number().min(0).max(100).optional(),
      type: stageTypeSchema.optional(),
    }),
    async handler(
      input: {
        pipelineId: string;
        name: string;
        sortOrder?: number;
        probability?: number;
        type?: "open" | "won" | "lost";
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      // Tenant scope check — make sure the pipeline belongs to the caller.
      const [pipeline] = await deps.db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(
          and(
            eq(pipelines.id, input.pipelineId),
            eq(pipelines.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      if (!pipeline) {
        return {
          ok: false,
          error: { code: "not_found", message: "Pipeline not found", retryable: false },
        };
      }

      const [created] = await deps.db
        .insert(pipelineStages)
        .values({
          pipelineId: input.pipelineId,
          name: input.name,
          sortOrder: input.sortOrder ?? 0,
          probability: input.probability ?? 0,
          type: input.type ?? "open",
        })
        .returning();

      return { ok: true, result: { data: created } };
    },
  };

  const updateStage: Tool = {
    name: "pipelines.update_stage",
    description: "Update a pipeline stage. Pass only the fields to change.",
    inputs: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      sortOrder: z.number().int().nonnegative().optional(),
      probability: z.number().min(0).max(100).optional(),
      type: stageTypeSchema.optional(),
    }),
    async handler(
      input: {
        id: string;
        name?: string;
        sortOrder?: number;
        probability?: number;
        type?: "open" | "won" | "lost";
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const { id, ...patch } = input;

      // Tenant scope check via the parent pipeline.
      const [stage] = await deps.db
        .select({ pipelineId: pipelineStages.pipelineId })
        .from(pipelineStages)
        .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
        .where(
          and(
            eq(pipelineStages.id, id),
            eq(pipelines.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      if (!stage) {
        return {
          ok: false,
          error: { code: "not_found", message: "Stage not found", retryable: false },
        };
      }

      const [updated] = await deps.db
        .update(pipelineStages)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(pipelineStages.id, id))
        .returning();

      return { ok: true, result: { data: updated } };
    },
  };

  const deleteStage: Tool = {
    name: "pipelines.delete_stage",
    description: "Delete a pipeline stage.",
    inputs: z.object({ id: z.string().uuid() }),
    async handler(input: { id: string }, ctx: ToolContext): Promise<ToolResult> {
      // Tenant scope check via the parent pipeline.
      const [stage] = await deps.db
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
        .where(
          and(
            eq(pipelineStages.id, input.id),
            eq(pipelines.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      if (!stage) {
        return {
          ok: false,
          error: { code: "not_found", message: "Stage not found", retryable: false },
        };
      }

      const [deleted] = await deps.db
        .delete(pipelineStages)
        .where(eq(pipelineStages.id, input.id))
        .returning();

      return { ok: true, result: { data: deleted } };
    },
  };

  return [list, get, create, update, del, forecast, createStage, updateStage, deleteStage];
}
