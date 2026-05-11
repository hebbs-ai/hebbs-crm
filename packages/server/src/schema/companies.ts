import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const companies = pgTable(
  "crm__companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    size: text("size"),
    website: text("website"),
    address: text("address"),
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
    tenantIdx: index("crm__companies_tenant_idx").on(table.tenantId),
    ownerIdx: index("crm__companies_owner_idx").on(
      table.tenantId,
      table.ownerId
    ),
    domainIdx: index("crm__companies_domain_idx").on(
      table.tenantId,
      table.domain
    ),
  })
);
