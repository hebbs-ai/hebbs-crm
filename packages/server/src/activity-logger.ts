import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ActivityType } from "@boringos-crm/shared";

// Closed enum so callers can't sneak in arbitrary strings that would
// break UI filters or kanban groupings downstream.
const ALLOWED_TYPES = ["call", "email", "meeting", "note", "task"] as const;

interface LogOpts {
  db: PostgresJsDatabase;
  tenantId: string;
  userId?: string;
  /** Defaults to 'note' for backwards compatibility with every existing call site. */
  type?: ActivityType;
  subject: string;
  body?: string;
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
}

export async function logActivity(opts: LogOpts) {
  const type: ActivityType =
    opts.type && (ALLOWED_TYPES as readonly string[]).includes(opts.type)
      ? opts.type
      : "note";
  await opts.db
    .execute(sql`
      INSERT INTO crm__activities (tenant_id, type, subject, body, contact_id, deal_id, company_id, user_id, occurred_at)
      VALUES (
        ${opts.tenantId}, ${type}, ${opts.subject}, ${opts.body ?? null},
        ${opts.contactId ?? null}, ${opts.dealId ?? null}, ${opts.companyId ?? null},
        ${opts.userId ?? opts.tenantId}, now()
      )
    `)
    .catch(() => {});
}

/**
 * Compare old and new deal values, return a human-readable change description.
 */
export function describeDealChanges(
  old: Record<string, unknown>,
  updated: Record<string, unknown>,
  stageNames?: Map<string, string>,
): string | null {
  const changes: string[] = [];

  if (updated.stageId && updated.stageId !== old.stageId) {
    const from = stageNames?.get(old.stageId as string) ?? "previous stage";
    const to = stageNames?.get(updated.stageId as string) ?? "new stage";
    changes.push(`Stage changed from ${from} to ${to}`);
  }
  if (updated.value !== undefined && updated.value !== old.value) {
    const from = formatCents(old.value as number);
    const to = formatCents(updated.value as number);
    changes.push(`Value changed from ${from} to ${to}`);
  }
  if (updated.probability !== undefined && updated.probability !== old.probability) {
    changes.push(`Probability changed from ${old.probability}% to ${updated.probability}%`);
  }
  if (updated.expectedCloseDate !== undefined && String(updated.expectedCloseDate) !== String(old.expectedCloseDate)) {
    changes.push(`Close date updated`);
  }
  if (updated.contactId !== undefined && updated.contactId !== old.contactId) {
    changes.push(`Contact updated`);
  }
  if (updated.companyId !== undefined && updated.companyId !== old.companyId) {
    changes.push(`Company updated`);
  }
  if (updated.title !== undefined && updated.title !== old.title) {
    changes.push(`Title changed to "${updated.title}"`);
  }

  return changes.length > 0 ? changes.join(". ") : null;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}
