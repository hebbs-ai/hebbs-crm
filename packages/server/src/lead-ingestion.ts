// Lead auto-creation from inbound email.
//
// The flow has three gates the inbox sync passes through (the older
// eager `ensureContactForInbound` is kept as a thin compat shim):
//
//   1. Header prefilter (`classifyAutomatedMail`) — automated mail
//      stops here. The caller marks the inbox item as triage=noise
//      with source=header-prefilter and skips lead creation.
//   2. `resolveOrDeferLead` — synchronous resolver. Existing contacts
//      win immediately: we touch their updated_at and re-engage any
//      stale open deals. New senders return `defer: true` so the
//      caller knows to wait for triage + ICP before creating anything.
//   3. `qualifyAndCreateLead` (a.k.a. `crm.leads.materialize`) — runs
//      after triage labels the inbox item urgent/important AND the
//      ICP classifier votes "fit". Creates contact + (non-consumer)
//      company. Does NOT create a deal — that happens on user reply.
//
// All public helpers NEVER throw — they swallow errors and report a
// `skipped/skipReason` so `inbox.sync` can keep ingesting.

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { logActivity } from "./activity-logger.js";
import { resolveContactByEmail, parseFromHeader } from "./inbox-resolve.js";
import type { ResolvedEntities } from "./inbox-resolve.js";
import { emitCrm, type CrmDeps } from "./tools/deps.js";

const NOREPLY_LOCAL_PARTS = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
  "notifications",
  "notification",
  "bounce",
  "bounces",
  "unsubscribe",
  "auto-confirm",
];

export const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.in",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "tutanota.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "mail.com",
  "gmx.com",
  "gmx.de",
  "yandex.com",
  "yandex.ru",
]);

export interface ResolveResult extends ResolvedEntities {
  /** True when an existing contact owned this sender (caller should log Received: activity + touch). */
  matched: boolean;
  /** True when we want to defer lead creation to the ICP classifier. */
  deferred: boolean;
  /** True when we skipped this sender outright (bot / unparseable). */
  skipped: boolean;
  skipReason?: string;
  /** Cached email + display info so the deferred path doesn't re-parse. */
  email?: string | null;
  displayName?: string | null;
}

export interface IngestionResult extends ResolvedEntities {
  /** True when this call created a new contact. */
  created: boolean;
  /** True when we skipped auto-creation (bot sender, parse error, etc). */
  skipped: boolean;
  skipReason?: string;
}

interface NameParts {
  first: string;
  last: string;
}

function parseDisplayName(fromHeader: string | null | undefined): string | null {
  if (!fromHeader) return null;
  const angle = fromHeader.match(/^\s*"?(.*?)"?\s*<[^>]+>\s*$/);
  const raw = angle?.[1]?.trim();
  if (raw && raw.length > 0) return raw;
  return null;
}

function splitName(displayName: string, emailLocal: string): NameParts {
  const cleaned = displayName.replace(/\s+/g, " ").trim();
  if (!cleaned) return { first: emailLocal || "Unknown", last: "" };
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function isBotLocalPart(local: string): boolean {
  const lower = local.toLowerCase();
  return NOREPLY_LOCAL_PARTS.some((p) => lower.includes(p));
}

const STALE_DEAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Touch an existing contact's `updated_at`. If they have an open deal
 * that hasn't moved in `STALE_DEAL_MS`, log a "re-engaged" note on it.
 * Safe to call repeatedly — duplicate re-engage notes are guarded by
 * checking the most-recent activity timestamp.
 */
async function touchExistingContact(
  deps: CrmDeps,
  tenantId: string,
  resolved: ResolvedEntities,
  fromHeader: string | null | undefined,
): Promise<void> {
  if (!resolved.contactId) return;

  try {
    await deps.db.execute(sql`
      UPDATE crm__contacts
      SET updated_at = now()
      WHERE id = ${resolved.contactId} AND tenant_id = ${tenantId}
    `);
  } catch (err) {
    void err;
  }

  if (!resolved.dealId) return;

  try {
    const rows = (await deps.db.execute(sql`
      SELECT d.updated_at, s.type
      FROM crm__deals d
      LEFT JOIN crm__pipeline_stages s ON s.id = d.stage_id
      WHERE d.id = ${resolved.dealId} AND d.tenant_id = ${tenantId}
      LIMIT 1
    `)) as unknown as Array<{ updated_at: Date; type: string | null }>;
    if (!rows[0]) return;
    if (rows[0].type !== "open") return;
    const idleMs = Date.now() - new Date(rows[0].updated_at).getTime();
    if (idleMs < STALE_DEAL_MS) return;

    await logActivity({
      db: deps.db,
      tenantId,
      type: "note",
      subject: "Re-engaged via inbound email",
      body: fromHeader
        ? `Sender replied after ${Math.floor(idleMs / (24 * 60 * 60 * 1000))} idle days: ${fromHeader}`
        : `Sender replied after ${Math.floor(idleMs / (24 * 60 * 60 * 1000))} idle days.`,
      dealId: resolved.dealId,
      contactId: resolved.contactId,
      companyId: resolved.companyId,
    });

    await deps.db.execute(sql`
      UPDATE crm__deals
      SET updated_at = now()
      WHERE id = ${resolved.dealId} AND tenant_id = ${tenantId}
    `);
  } catch (err) {
    void err;
  }
}

/**
 * Lookup-only step. Phase 3a/3c:
 *   - existing contact → touch updated_at + re-engage stale deals, return matched=true.
 *   - unparseable or bot sender → skipped.
 *   - otherwise → deferred=true (lead creation waits for triage + ICP).
 */
export async function resolveOrDeferLead(
  deps: CrmDeps,
  tenantId: string,
  fromHeader: string | null | undefined,
): Promise<ResolveResult> {
  const email = parseFromHeader(fromHeader);
  if (!email || !email.includes("@")) {
    return {
      contactId: null,
      dealId: null,
      companyId: null,
      matched: false,
      deferred: false,
      skipped: true,
      skipReason: "unparseable_from",
      email: null,
    };
  }

  const existing = await resolveContactByEmail(deps.db, tenantId, email);
  if (existing.contactId) {
    await touchExistingContact(deps, tenantId, existing, fromHeader);
    return {
      ...existing,
      matched: true,
      deferred: false,
      skipped: false,
      email,
      displayName: parseDisplayName(fromHeader),
    };
  }

  const [local] = email.split("@");
  if (!local) {
    return {
      contactId: null,
      dealId: null,
      companyId: null,
      matched: false,
      deferred: false,
      skipped: true,
      skipReason: "unparseable_from",
      email,
    };
  }
  if (isBotLocalPart(local)) {
    return {
      contactId: null,
      dealId: null,
      companyId: null,
      matched: false,
      deferred: false,
      skipped: true,
      skipReason: "bot_sender",
      email,
    };
  }

  return {
    contactId: null,
    dealId: null,
    companyId: null,
    matched: false,
    deferred: true,
    skipped: false,
    email,
    displayName: parseDisplayName(fromHeader),
  };
}

/**
 * Create the contact + (non-consumer-domain) company for an ICP-fit
 * sender. Does NOT create a deal — deal creation moved to phase 4
 * (gated on user reply or explicit promote-to-deal action).
 *
 * Caller is expected to have already verified the sender is ICP-fit
 * (via `crm.leads.classify_and_create`) and that no contact exists
 * yet.
 */
export async function qualifyAndCreateLead(
  deps: CrmDeps,
  tenantId: string,
  args: {
    email: string;
    displayName?: string | null;
    suggestedContactName?: string | null;
    suggestedCompany?: string | null;
    classification?: {
      icpFit: boolean;
      confidence: number;
      reason: string;
    };
  },
): Promise<IngestionResult> {
  const { email, displayName, suggestedContactName, suggestedCompany, classification } = args;

  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return {
      contactId: null,
      dealId: null,
      companyId: null,
      created: false,
      skipped: true,
      skipReason: "unparseable_from",
    };
  }

  const domainLower = domain.toLowerCase();
  const localLower = local.toLowerCase();
  if (isBotLocalPart(localLower)) {
    return {
      contactId: null,
      dealId: null,
      companyId: null,
      created: false,
      skipped: true,
      skipReason: "bot_sender",
    };
  }

  try {
    const baseName = suggestedContactName?.trim() || displayName?.trim() || "";
    const { first, last } = splitName(baseName, local);
    const isConsumer = CONSUMER_DOMAINS.has(domainLower);

    let companyId: string | null = null;
    if (!isConsumer) {
      const companyRows = (await deps.db.execute(sql`
        SELECT id FROM crm__companies
        WHERE tenant_id = ${tenantId}
          AND lower(domain) = ${domainLower}
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (companyRows[0]) {
        companyId = companyRows[0].id;
      } else {
        companyId = randomUUID();
        const companyName = suggestedCompany?.trim() || humanizeDomain(domainLower);
        await deps.db.execute(sql`
          INSERT INTO crm__companies (id, tenant_id, owner_id, name, domain, custom_fields, created_at, updated_at)
          VALUES (
            ${companyId}, ${tenantId}, ${tenantId},
            ${companyName}, ${domainLower}, '{}'::jsonb, now(), now()
          )
        `);
        await logActivity({
          db: deps.db,
          tenantId,
          subject: `Company created: ${companyName}`,
          companyId,
        });
        emitCrm(deps, "entity.created", tenantId, {
          entityType: "crm_company",
          entityId: companyId,
        });
      }
    }

    // Stamp `customFields.leadClassification` so the maintenance pass
    // can see *why* a contact was auto-created (confidence + reason).
    const customFields = classification
      ? {
          leadClassification: {
            confidence: classification.confidence,
            reason: classification.reason,
            classifiedAt: new Date().toISOString(),
          },
        }
      : {};
    const contactId = randomUUID();
    await deps.db.execute(sql`
      INSERT INTO crm__contacts (id, tenant_id, owner_id, first_name, last_name, email, company_id, source, tags, custom_fields, created_at, updated_at)
      VALUES (
        ${contactId}, ${tenantId}, ${tenantId},
        ${first}, ${last}, ${email}, ${companyId},
        'inbox-auto', '[]'::jsonb, ${JSON.stringify(customFields)}::jsonb, now(), now()
      )
    `);
    await logActivity({
      db: deps.db,
      tenantId,
      subject: `Contact created: ${first} ${last}`.trim(),
      contactId,
      companyId,
      body: classification?.reason ?? undefined,
    });
    emitCrm(deps, "entity.created", tenantId, {
      entityType: "crm_contact",
      entityId: contactId,
    });

    emitCrm(deps, "lead.auto_created", tenantId, {
      contactId,
      dealId: null,
      companyId,
      email,
    });

    return { contactId, dealId: null, companyId, created: true, skipped: false };
  } catch (err) {
    void err;
    return {
      contactId: null,
      dealId: null,
      companyId: null,
      created: false,
      skipped: true,
      skipReason: "create_failed",
    };
  }
}

/**
 * @deprecated Kept as a compat shim — calls `resolveOrDeferLead` and
 * returns the matched-contact branch only. New senders fall through
 * to the deferred path (no contact created here). Use the new flow
 * (`resolveOrDeferLead` + `crm.leads.classify_and_create` +
 * `crm.leads.materialize`) instead.
 */
export async function ensureContactForInbound(
  deps: CrmDeps,
  tenantId: string,
  fromHeader: string | null | undefined,
  _subject: string | null | undefined,
): Promise<IngestionResult> {
  const result = await resolveOrDeferLead(deps, tenantId, fromHeader);
  if (result.matched) {
    return {
      contactId: result.contactId,
      dealId: result.dealId,
      companyId: result.companyId,
      created: false,
      skipped: false,
    };
  }
  return {
    contactId: null,
    dealId: null,
    companyId: null,
    created: false,
    skipped: result.skipped || result.deferred,
    skipReason: result.deferred ? "deferred_to_icp" : result.skipReason,
  };
}

export function humanizeDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length < 2) return domain;
  const core = parts[parts.length - 2];
  if (!core) return domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}
