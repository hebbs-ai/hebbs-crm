// Resolve the CRM (contact, deal, company) tuple an inbox item refers to.
//
// Used by tools that want to attach an activity row to the right
// contact/deal/company without re-implementing the lookup each time:
// `inbox.reply`, `actions.execute("reply"|"schedule_meeting"|"log_activity")`,
// and `inbox.sync` (for inbound-email activity logging).
//
// Resolution order (cheapest first):
//   1. `metadata.crmLens.contactMatch.id` / `dealContext.id` written by the
//      email-lens agent.
//   2. Look up `crm__contacts` by lower(email) on the inbox item's `from`
//      header.
//   3. Walk to the contact's first open deal (most recent by createdAt).
//
// All return fields are nullable — every caller should pass them straight
// into `logActivity` (which already handles nulls).

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface ResolvedEntities {
  contactId: string | null;
  dealId: string | null;
  companyId: string | null;
}

/** Extract the email address out of a Gmail `From:` header. */
export function parseFromHeader(from: string | null | undefined): string | null {
  if (!from) return null;
  const angle = from.match(/<([^>]+)>/);
  const raw = angle?.[1] ?? from;
  return raw.trim().toLowerCase() || null;
}

/**
 * Look up the contact (+ their company + their best open deal) for an
 * inbox item id, in the given tenant. Never throws — returns nulls on
 * any failure.
 */
export async function resolveInboxItemEntities(
  db: PostgresJsDatabase,
  tenantId: string,
  itemId: string,
): Promise<ResolvedEntities> {
  try {
    const itemRows = (await db.execute(sql`
      SELECT "from", metadata
      FROM inbox_items
      WHERE id = ${itemId} AND tenant_id = ${tenantId}
      LIMIT 1
    `)) as unknown as Array<{
      from: string | null;
      metadata: Record<string, unknown> | null;
    }>;
    const item = itemRows[0];
    if (!item) return { contactId: null, dealId: null, companyId: null };

    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const lens = (meta.crmLens ?? {}) as Record<string, unknown>;
    const contactMatch = (lens.contactMatch ?? null) as
      | { id?: string }
      | null;
    const dealContext = (lens.dealContext ?? null) as { id?: string } | null;

    let contactId = contactMatch?.id ?? null;
    let dealId = dealContext?.id ?? null;
    let companyId: string | null = null;

    // Trust the email-lens-stored ids when present, but also fetch the
    // company id (lens doesn't store it) and confirm the deal still
    // exists.
    if (contactId) {
      const rows = (await db.execute(sql`
        SELECT company_id FROM crm__contacts
        WHERE id = ${contactId} AND tenant_id = ${tenantId}
        LIMIT 1
      `)) as unknown as Array<{ company_id: string | null }>;
      if (rows[0]) {
        companyId = rows[0].company_id;
      } else {
        // Lens pointer is stale — fall through to email lookup.
        contactId = null;
        dealId = null;
      }
    }

    if (!contactId) {
      const email = parseFromHeader(item.from);
      if (email) {
        const rows = (await db.execute(sql`
          SELECT id, company_id FROM crm__contacts
          WHERE tenant_id = ${tenantId} AND lower(email) = ${email}
          LIMIT 1
        `)) as unknown as Array<{ id: string; company_id: string | null }>;
        if (rows[0]) {
          contactId = rows[0].id;
          companyId = rows[0].company_id;
        }
      }
    }

    if (contactId && !dealId) {
      // Pick the most recently updated still-open deal for this contact.
      // "Open" = pipeline stage type != 'won' AND != 'lost'.
      const rows = (await db.execute(sql`
        SELECT d.id
        FROM crm__deals d
        LEFT JOIN crm__pipeline_stages s ON s.id = d.stage_id
        WHERE d.tenant_id = ${tenantId}
          AND d.contact_id = ${contactId}
          AND (s.type IS NULL OR s.type NOT IN ('won', 'lost'))
        ORDER BY d.updated_at DESC
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (rows[0]) dealId = rows[0].id;
    }

    return { contactId, dealId, companyId };
  } catch {
    return { contactId: null, dealId: null, companyId: null };
  }
}

/**
 * Same shape as `resolveInboxItemEntities` but keyed off an email
 * address — used by `inbox.sync` to attach a received-email activity
 * before the lens has run.
 */
export async function resolveContactByEmail(
  db: PostgresJsDatabase,
  tenantId: string,
  email: string | null | undefined,
): Promise<ResolvedEntities> {
  const e = parseFromHeader(email ?? null);
  if (!e) return { contactId: null, dealId: null, companyId: null };
  try {
    const rows = (await db.execute(sql`
      SELECT id, company_id FROM crm__contacts
      WHERE tenant_id = ${tenantId} AND lower(email) = ${e}
      LIMIT 1
    `)) as unknown as Array<{ id: string; company_id: string | null }>;
    if (!rows[0]) return { contactId: null, dealId: null, companyId: null };
    const contactId = rows[0].id;
    const companyId = rows[0].company_id;
    const dealRows = (await db.execute(sql`
      SELECT d.id
      FROM crm__deals d
      LEFT JOIN crm__pipeline_stages s ON s.id = d.stage_id
      WHERE d.tenant_id = ${tenantId}
        AND d.contact_id = ${contactId}
        AND (s.type IS NULL OR s.type NOT IN ('won', 'lost'))
      ORDER BY d.updated_at DESC
      LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    return { contactId, dealId: dealRows[0]?.id ?? null, companyId };
  } catch {
    return { contactId: null, dealId: null, companyId: null };
  }
}
