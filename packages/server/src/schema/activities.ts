import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type { ActivityType } from "@boringos-crm/shared";

export const activities = pgTable(
  "crm_activities",
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
    tenantIdx: index("crm_activities_tenant_idx").on(table.tenantId),
    contactIdx: index("crm_activities_contact_idx").on(
      table.tenantId,
      table.contactId
    ),
    dealIdx: index("crm_activities_deal_idx").on(table.tenantId, table.dealId),
    companyIdx: index("crm_activities_company_idx").on(
      table.tenantId,
      table.companyId
    ),
    userIdx: index("crm_activities_user_idx").on(table.tenantId, table.userId),
    occurredIdx: index("crm_activities_occurred_idx").on(table.occurredAt),
  })
);
