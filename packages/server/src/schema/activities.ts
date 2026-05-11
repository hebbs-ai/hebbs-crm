import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type { ActivityType } from "@boringos-crm/shared";

export const activities = pgTable(
  "crm__activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    type: text("type").$type<ActivityType>().notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    contactId: uuid("contact_id"),
    dealId: uuid("deal_id"),
    companyId: uuid("company_id"),
    userId: uuid("user_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata")
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
    tenantIdx: index("crm__activities_tenant_idx").on(table.tenantId),
    contactIdx: index("crm__activities_contact_idx").on(
      table.tenantId,
      table.contactId
    ),
    dealIdx: index("crm__activities_deal_idx").on(table.tenantId, table.dealId),
    companyIdx: index("crm__activities_company_idx").on(
      table.tenantId,
      table.companyId
    ),
    userIdx: index("crm__activities_user_idx").on(table.tenantId, table.userId),
    occurredIdx: index("crm__activities_occurred_idx").on(table.occurredAt),
  })
);
