// Lead auto-creation from inbound email.
//
// Goal: when `inbox.sync` pulls in an email from a sender who isn't
// already in `crm__contacts`, automatically create the contact (+
// optionally a company and a stub deal) so the user's CRM stays in
// step with the inbox. The v1 CRM did this implicitly; v2 lost it
// in the module rewrite and we're restoring it here.
//
// Public surface:
//   ensureContactForInbound(db, deps, tenantId, fromHeader, hint)
//
// Returns the resolved tuple plus a `created` boolean so the caller
// can decide whether to fire a `crm.lead.auto_created` event.
//
// Skips auto-creation when:
//   - the local-part looks bot-y (noreply, mailer-daemon, …)
//   - the email is unparseable / empty
//
// For consumer domains (gmail.com, outlook.com, …) we still create
// the contact but leave companyId null — those addresses aren't a
// company signal.

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

const CONSUMER_DOMAINS = new Set([
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

export interface IngestionResult extends ResolvedEntities {
  /** True when this call created a new contact (and optionally deal/company). */
  created: boolean;
  /** True when we skipped auto-creation (bot sender, parse error, etc). */
  skipped: boolean;
  skipReason?: string;
}

interface NameParts {
  first: string;
  last: string;
}

/** Pull a display name out of a Gmail-style `From:` header. */
function parseDisplayName(fromHeader: string | null | undefined): string | null {
  if (!fromHeader) return null;
  // Match `Display Name <email>` first.
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

/**
 * Resolve an inbound email's sender to a CRM contact, auto-creating
 * the contact (+ stub company + stub deal) when the sender is new.
 *
 * NEVER throws — falls back to a `{ contactId: null, …, skipped: true }`
 * shape on any failure so `inbox.sync` can keep ingesting.
 */
export async function ensureContactForInbound(
  deps: CrmDeps,
  tenantId: string,
  fromHeader: string | null | undefined,
  subject: string | null | undefined,
): Promise<IngestionResult> {
  const email = parseFromHeader(fromHeader);
  if (!email || !email.includes("@")) {
    return {
      contactId: null,
      dealId: null,
      companyId: null,
      created: false,
      skipped: true,
      skipReason: "unparseable_from",
    };
  }

  // Existing contact wins — keep dedupe cheap.
  const existing = await resolveContactByEmail(deps.db, tenantId, email);
  if (existing.contactId) {
    return { ...existing, created: false, skipped: false };
  }

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

  const localLower = local.toLowerCase();
  if (NOREPLY_LOCAL_PARTS.some((p) => localLower.includes(p))) {
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
    const display = parseDisplayName(fromHeader);
    const { first, last } = splitName(display ?? "", local);
    const domainLower = domain.toLowerCase();
    const isConsumer = CONSUMER_DOMAINS.has(domainLower);

    let companyId: string | null = null;
    if (!isConsumer) {
      // Find or create a company per (tenant, domain).
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
        const companyName = humanizeDomain(domainLower);
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

    const contactId = randomUUID();
    await deps.db.execute(sql`
      INSERT INTO crm__contacts (id, tenant_id, owner_id, first_name, last_name, email, company_id, source, tags, custom_fields, created_at, updated_at)
      VALUES (
        ${contactId}, ${tenantId}, ${tenantId},
        ${first}, ${last}, ${email}, ${companyId},
        'inbox-auto', '[]'::jsonb, '{}'::jsonb, now(), now()
      )
    `);
    await logActivity({
      db: deps.db,
      tenantId,
      subject: `Contact created: ${first} ${last}`.trim(),
      contactId,
      companyId,
    });
    emitCrm(deps, "entity.created", tenantId, {
      entityType: "crm_contact",
      entityId: contactId,
    });

    // Stub deal — picks the first 'open' stage of the default pipeline.
    let dealId: string | null = null;
    const stageRows = (await deps.db.execute(sql`
      SELECT s.id, s.pipeline_id FROM crm__pipeline_stages s
      JOIN crm__pipelines p ON p.id = s.pipeline_id
      WHERE p.tenant_id = ${tenantId} AND p.is_default = true AND s.type = 'open'
      ORDER BY s.sort_order ASC
      LIMIT 1
    `)) as unknown as Array<{ id: string; pipeline_id: string }>;
    if (stageRows[0]) {
      dealId = randomUUID();
      const titleBase = display?.trim() || `${first} ${last}`.trim() || email;
      const companyPart = companyId
        ? ` — ${humanizeDomain(domainLower)}`
        : "";
      const dealTitle = `${titleBase}${companyPart}`.slice(0, 200);
      await deps.db.execute(sql`
        INSERT INTO crm__deals (
          id, tenant_id, owner_id, title, value, currency,
          pipeline_id, stage_id, contact_id, company_id, custom_fields, created_at, updated_at
        ) VALUES (
          ${dealId}, ${tenantId}, ${tenantId},
          ${dealTitle}, 0, 'USD',
          ${stageRows[0].pipeline_id}, ${stageRows[0].id},
          ${contactId}, ${companyId}, '{}'::jsonb, now(), now()
        )
      `);
      await logActivity({
        db: deps.db,
        tenantId,
        subject: `Deal created: ${dealTitle} ($0)`,
        dealId,
        contactId,
        companyId,
      });
      emitCrm(deps, "entity.created", tenantId, {
        entityType: "crm_deal",
        entityId: dealId,
      });
    }

    emitCrm(deps, "lead.auto_created", tenantId, {
      contactId,
      dealId,
      companyId,
      email,
      subject: subject ?? null,
    });

    return { contactId, dealId, companyId, created: true, skipped: false };
  } catch (err) {
    // On any insert failure, fall back to the contact-not-found result so
    // ingest never fails the parent sync.
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
 * Title-case the second-level domain so the auto-created company has
 * a readable name. Falls back to the raw domain when stripping fails.
 */
function humanizeDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length < 2) return domain;
  const core = parts[parts.length - 2];
  if (!core) return domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}
