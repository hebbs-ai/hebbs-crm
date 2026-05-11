import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  real,
  index,
} from "drizzle-orm/pg-core";

export const pipelines = pgTable(
  "crm__pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index("crm__pipelines_tenant_idx").on(table.tenantId),
  })
);

export const pipelineStages = pgTable(
  "crm__pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    probability: real("probability").notNull().default(0),
    type: text("type").$type<"open" | "won" | "lost">().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pipelineIdx: index("crm__stages_pipeline_idx").on(table.pipelineId),
    sortIdx: index("crm__stages_sort_idx").on(
      table.pipelineId,
      table.sortOrder
    ),
  })
);
