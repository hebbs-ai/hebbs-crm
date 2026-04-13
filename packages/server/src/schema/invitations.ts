import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const invitations = pgTable("crm_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("staff"),
  code: text("code").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending, accepted, expired
  invitedBy: text("invited_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
