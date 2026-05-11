import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const contacts = pgTable(
  "crm__contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    companyId: uuid("company_id"),
    title: text("title"),
    linkedIn: text("linkedin"),
    source: text("source"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
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
    tenantIdx: index("crm__contacts_tenant_idx").on(table.tenantId),
    ownerIdx: index("crm__contacts_owner_idx").on(table.tenantId, table.ownerId),
    companyIdx: index("crm__contacts_company_idx").on(
      table.tenantId,
      table.companyId
    ),
    emailIdx: index("crm__contacts_email_idx").on(table.tenantId, table.email),
  })
);
