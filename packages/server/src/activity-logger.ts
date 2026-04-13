import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

interface LogOpts {
  db: PostgresJsDatabase;
  tenantId: string;
  userId?: string;
  subject: string;
  body?: string;
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
}

export async function logActivity(opts: LogOpts) {
  // Use raw SQL to avoid Drizzle type strictness issues with nullable fields
  await opts.db.execute(sql`
    INSERT INTO crm_activities (tenant_id, type, subject, body, contact_id, deal_id, company_id, user_id, occurred_at)
    VALUES (
      ${opts.tenantId}, 'note', ${opts.subject}, ${opts.body ?? null},
      ${opts.contactId ?? null}, ${opts.dealId ?? null}, ${opts.companyId ?? null},
      ${opts.userId ?? opts.tenantId}, now()
    )
  `).catch(() => {}); // never fail the parent request
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
