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
  const cfDelta = describeCustomFieldsDelta(
    old.customFields as Record<string, unknown> | null | undefined,
    updated.customFields as Record<string, unknown> | null | undefined,
  );
  if (cfDelta) changes.push(cfDelta);

  return changes.length > 0 ? changes.join(". ") : null;
}

/**
 * Same idea as `describeDealChanges` but for contacts. Fields that
 * commonly change (firstName, lastName, email, phone, title,
 * linkedIn, source, companyId, tags) get human-readable diffs;
 * customFields gets a "keys touched" summary so dossier writes
 * still show up in the timeline without dumping the whole JSON.
 */
export function describeContactChanges(
  old: Record<string, unknown>,
  patch: Record<string, unknown>,
): string | null {
  const changes: string[] = [];
  const scalar: Array<[string, string]> = [
    ["firstName", "First name"],
    ["lastName", "Last name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["title", "Title"],
    ["linkedIn", "LinkedIn"],
    ["source", "Source"],
  ];
  for (const [field, label] of scalar) {
    if (!(field in patch)) continue;
    const before = old[field];
    const after = patch[field];
    if ((before ?? null) === (after ?? null)) continue;
    changes.push(`${label} changed from "${formatScalar(before)}" to "${formatScalar(after)}"`);
  }
  if ("companyId" in patch && (old.companyId ?? null) !== (patch.companyId ?? null)) {
    changes.push(patch.companyId ? "Linked to a different company" : "Company link removed");
  }
  if ("tags" in patch) {
    const before = (old.tags as string[] | null | undefined) ?? [];
    const after = (patch.tags as string[] | null | undefined) ?? [];
    const added = after.filter((t) => !before.includes(t));
    const removed = before.filter((t) => !after.includes(t));
    if (added.length || removed.length) {
      const parts: string[] = [];
      if (added.length) parts.push(`+${added.join(", ")}`);
      if (removed.length) parts.push(`-${removed.join(", ")}`);
      changes.push(`Tags ${parts.join(" / ")}`);
    }
  }
  const cfDelta = describeCustomFieldsDelta(
    old.customFields as Record<string, unknown> | null | undefined,
    patch.customFields as Record<string, unknown> | null | undefined,
  );
  if (cfDelta) changes.push(cfDelta);
  return changes.length > 0 ? changes.join(". ") : null;
}

/**
 * Companies are simpler than contacts — name + domain + industry +
 * size + website + address + customFields. Same delta style as
 * `describeContactChanges`.
 */
export function describeCompanyChanges(
  old: Record<string, unknown>,
  patch: Record<string, unknown>,
): string | null {
  const changes: string[] = [];
  const scalar: Array<[string, string]> = [
    ["name", "Name"],
    ["domain", "Domain"],
    ["industry", "Industry"],
    ["size", "Size"],
    ["website", "Website"],
    ["address", "Address"],
  ];
  for (const [field, label] of scalar) {
    if (!(field in patch)) continue;
    const before = old[field];
    const after = patch[field];
    if ((before ?? null) === (after ?? null)) continue;
    changes.push(`${label} changed from "${formatScalar(before)}" to "${formatScalar(after)}"`);
  }
  const cfDelta = describeCustomFieldsDelta(
    old.customFields as Record<string, unknown> | null | undefined,
    patch.customFields as Record<string, unknown> | null | undefined,
  );
  if (cfDelta) changes.push(cfDelta);
  return changes.length > 0 ? changes.join(". ") : null;
}

/**
 * Summarise which customFields keys changed without dumping the
 * (often large, dossier-shaped) JSON values into the activity body.
 * Skips when the patch doesn't touch customFields at all.
 */
function describeCustomFieldsDelta(
  old: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
): string | null {
  if (!patch) return null;
  const before = old ?? {};
  const touched: string[] = [];
  for (const key of Object.keys(patch)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(patch[key])) touched.push(key);
  }
  if (!touched.length) return null;
  return `Custom fields updated: ${touched.join(", ")}`;
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}
