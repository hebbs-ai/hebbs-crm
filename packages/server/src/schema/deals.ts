import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  index,
} from "drizzle-orm/pg-core";

export const deals = pgTable(
  "crm_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    value: integer("value").notNull().default(0), // cents
    currency: text("currency").notNull().default("USD"),
    pipelineId: uuid("pipeline_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    probability: real("probability"),
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    contactId: uuid("contact_id"),
    companyId: uuid("company_id"),
    lostReason: text("lost_reason"),
    customFields: jsonb("custom_fields")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index("crm_deals_tenant_idx").on(table.tenantId),
    ownerIdx: index("crm_deals_owner_idx").on(table.tenantId, table.ownerId),
    pipelineIdx: index("crm_deals_pipeline_idx").on(
      table.tenantId,
      table.pipelineId
    ),
    stageIdx: index("crm_deals_stage_idx").on(
      table.tenantId,
      table.pipelineId,
      table.stageId
    ),
    contactIdx: index("crm_deals_contact_idx").on(
      table.tenantId,
      table.contactId
    ),
    companyIdx: index("crm_deals_company_idx").on(
      table.tenantId,
      table.companyId
    ),
  })
);
