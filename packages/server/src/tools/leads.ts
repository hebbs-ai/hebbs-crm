// CRM lead classification + materialization tools.
//
// Dispatched at /api/tools/crm.leads.*. Called by the
// `triage.classified -> classify_and_create -> materialize` workflow
// seeded in lifecycle.ts. Together they replace the eager
// `ensureContactForInbound` path: lead creation only happens AFTER
// triage labels the item urgent/important AND the ICP classifier
// votes "fit".
//
// Tools:
//   crm.leads.classify_and_create { itemId } → { icpFit, confidence,
//       reason, suggestedContactName, suggestedCompany, email,
//       displayName }
//       Read-only. Reads the inbox item + business_profile and
//       makes a deterministic ICP fit decision. Does NOT write to DB.
//
//   crm.leads.materialize { itemId, classification? } → {
//       contactId, companyId, created, skipped, skipReason? }
//       Writes the contact + (non-consumer) company. Stamps inbox
//       metadata.crmLens. Does NOT create a deal — phase 4 (user
//       reply or explicit promote) owns deal creation.
//
//   crm.leads.scan_noise {} → { candidates: [...], totals }
//       Read-only. Lists auto-created contacts/companies/deals that
//       look like noise (newsletters, bot senders, all-noise triage).
//       Used by the crm-maintenance agent in phase 5.
//
//   crm.leads.delete_noise { contactIds, companyIds?, dealIds? } →
//       { deleted: { contacts, companies, deals } }
//       Cascading delete keyed by explicit id lists. Logs notes for
//       audit. Used by the crm-maintenance agent in phase 5.

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import {
  qualifyAndCreateLead,
  CONSUMER_DOMAINS,
} from "../lead-ingestion.js";
import { logActivity } from "../activity-logger.js";
import { emitCrm, type CrmDeps } from "./deps.js";

interface BusinessProfile {
  industry: string | null;
  whatWeDo: string | null;
  idealCustomer: string | null;
  signalExamples: string[];
  noiseExamples: string[];
  competitors: string[];
  tone: string | null;
}

function parseBusinessProfile(raw: string | null): BusinessProfile | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<BusinessProfile>;
    return {
      industry: typeof obj.industry === "string" ? obj.industry : null,
      whatWeDo: typeof obj.whatWeDo === "string" ? obj.whatWeDo : null,
      idealCustomer:
        typeof obj.idealCustomer === "string" ? obj.idealCustomer : null,
      signalExamples: Array.isArray(obj.signalExamples)
        ? obj.signalExamples.filter((s): s is string => typeof s === "string")
        : [],
      noiseExamples: Array.isArray(obj.noiseExamples)
        ? obj.noiseExamples.filter((s): s is string => typeof s === "string")
        : [],
      competitors: Array.isArray(obj.competitors)
        ? obj.competitors.filter((s): s is string => typeof s === "string")
        : [],
      tone: typeof obj.tone === "string" ? obj.tone : null,
    };
  } catch {
    return null;
  }
}

async function loadBusinessProfile(
  deps: CrmDeps,
  tenantId: string,
): Promise<BusinessProfile | null> {
  const rows = (await deps.db.execute(sql`
    SELECT value FROM tenant_settings
    WHERE tenant_id = ${tenantId} AND key = 'business_profile'
    LIMIT 1
  `)) as unknown as Array<{ value: string | null }>;
  return parseBusinessProfile(rows[0]?.value ?? null);
}

const BOT_LOCAL_PATTERNS = [
  /no[-._]?reply/i,
  /donotreply/i,
  /mailer[-._]?daemon/i,
  /postmaster/i,
  /bounce/i,
  /notifications?$/i,
  /unsubscribe/i,
];

function isBotLocal(local: string): boolean {
  return BOT_LOCAL_PATTERNS.some((re) => re.test(local));
}

interface Classification {
  icpFit: boolean;
  confidence: number;
  reason: string;
  suggestedContactName: string | null;
  suggestedCompany: string | null;
  email: string | null;
  displayName: string | null;
}

function parseFromHeader(from: string | null | undefined): {
  email: string | null;
  displayName: string | null;
} {
  if (!from) return { email: null, displayName: null };
  const angle = from.match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    return {
      displayName: (angle[1] ?? "").trim() || null,
      email: (angle[2] ?? "").trim().toLowerCase() || null,
    };
  }
  return {
    email: from.trim().toLowerCase() || null,
    displayName: null,
  };
}

function textMatchesAny(haystack: string, patterns: string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const p of patterns) {
    const needle = p.toLowerCase().trim();
    if (!needle) continue;
    if (lower.includes(needle)) return p;
  }
  return null;
}

function domainMatchesAny(domain: string, patterns: string[]): string | null {
  const lower = domain.toLowerCase();
  for (const p of patterns) {
    const needle = p.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (!needle) continue;
    if (lower === needle || lower.endsWith("." + needle)) return p;
  }
  return null;
}

/**
 * Deterministic ICP fit decision. Returns `icpFit: true` by default
 * (passive mode) when no business_profile is set — modules should
 * never be MORE aggressive than the user's policy. When the profile
 * is set, signal/noise/competitors rules apply in priority order.
 */
function classifyAgainstProfile(
  profile: BusinessProfile | null,
  inputs: {
    email: string;
    domain: string;
    subject: string | null;
    body: string | null;
    displayName: string | null;
  },
): Classification {
  const { email, domain, subject, body, displayName } = inputs;
  const haystack = [subject ?? "", body ?? "", displayName ?? "", email]
    .filter(Boolean)
    .join(" ");

  if (!profile) {
    return {
      icpFit: true,
      confidence: 0.3,
      reason: "No business profile set yet — defaulting to allow.",
      suggestedContactName: displayName,
      suggestedCompany: null,
      email,
      displayName,
    };
  }

  if (profile.competitors.length > 0) {
    const hitDomain = domainMatchesAny(domain, profile.competitors);
    const hitText = !hitDomain
      ? textMatchesAny(haystack, profile.competitors)
      : null;
    if (hitDomain || hitText) {
      return {
        icpFit: false,
        confidence: 1.0,
        reason: `Sender matches competitor "${hitDomain ?? hitText}"`,
        suggestedContactName: displayName,
        suggestedCompany: null,
        email,
        displayName,
      };
    }
  }

  if (profile.noiseExamples.length > 0) {
    const hit = textMatchesAny(haystack, profile.noiseExamples)
      ?? domainMatchesAny(domain, profile.noiseExamples);
    if (hit) {
      return {
        icpFit: false,
        confidence: 0.9,
        reason: `Sender matches noise pattern "${hit}"`,
        suggestedContactName: displayName,
        suggestedCompany: null,
        email,
        displayName,
      };
    }
  }

  if (profile.signalExamples.length > 0) {
    const hit = textMatchesAny(haystack, profile.signalExamples);
    if (hit) {
      return {
        icpFit: true,
        confidence: 0.9,
        reason: `Sender matches signal pattern "${hit}"`,
        suggestedContactName: displayName,
        suggestedCompany: null,
        email,
        displayName,
      };
    }
  }

  // No explicit signal/noise match. With an ICP description set, lean
  // slightly conservative — still allow, but flag low-confidence so the
  // maintenance agent can surface these later if they accumulate.
  if (profile.idealCustomer || profile.whatWeDo) {
    return {
      icpFit: true,
      confidence: 0.5,
      reason: "Default-allow: no explicit signal or noise match against business profile.",
      suggestedContactName: displayName,
      suggestedCompany: null,
      email,
      displayName,
    };
  }

  return {
    icpFit: true,
    confidence: 0.4,
    reason: "Business profile partially set — defaulting to allow.",
    suggestedContactName: displayName,
    suggestedCompany: null,
    email,
    displayName,
  };
}

export function createLeadTools(deps: CrmDeps): Tool[] {
  const classifyAndCreate: Tool = {
    name: "leads.classify_and_create",
    description:
      "Read inbox item + business profile and decide whether the sender is an ICP-fit potential lead. Read-only. Returns the classification; call crm.leads.materialize separately if icpFit is true.",
    inputs: z.object({ itemId: z.string().uuid() }),
    async handler(
      input: { itemId: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = (await deps.db.execute(sql`
        SELECT id, "from", subject, body, metadata
        FROM inbox_items
        WHERE id = ${input.itemId} AND tenant_id = ${ctx.tenantId}
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        from: string | null;
        subject: string | null;
        body: string | null;
        metadata: Record<string, unknown> | null;
      }>;
      const item = rows[0];
      if (!item) {
        return {
          ok: false,
          error: { code: "not_found", message: "Inbox item not found", retryable: false },
        };
      }

      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      const lens = (meta.crmLens ?? {}) as Record<string, unknown>;
      const existingContact = (lens.contactMatch ?? null) as
        | { id?: string }
        | null;
      if (existingContact?.id) {
        return {
          ok: true,
          result: {
            decision: "already_linked",
            contactId: existingContact.id,
            icpFit: true,
            confidence: 1.0,
            reason: "Existing contact already linked to this item.",
          },
        };
      }

      const headerClass = (meta.headerClassification ?? null) as
        | { automated?: boolean; kind?: string }
        | null;
      if (headerClass?.automated) {
        return {
          ok: true,
          result: {
            decision: "skip",
            icpFit: false,
            confidence: 1.0,
            reason: `Skipped by header prefilter (${headerClass.kind ?? "automated"}).`,
          },
        };
      }

      const { email, displayName } = parseFromHeader(item.from);
      if (!email) {
        return {
          ok: true,
          result: {
            decision: "skip",
            icpFit: false,
            confidence: 1.0,
            reason: "Unparseable From header.",
          },
        };
      }

      const [local, domain] = email.split("@");
      if (!domain) {
        return {
          ok: true,
          result: {
            decision: "skip",
            icpFit: false,
            confidence: 1.0,
            reason: "Sender email missing domain.",
          },
        };
      }
      if (local && isBotLocal(local)) {
        return {
          ok: true,
          result: {
            decision: "skip",
            icpFit: false,
            confidence: 1.0,
            reason: "Sender local-part looks like a bot/no-reply address.",
          },
        };
      }

      const profile = await loadBusinessProfile(deps, ctx.tenantId);
      const classification = classifyAgainstProfile(profile, {
        email,
        domain,
        subject: item.subject,
        body: item.body,
        displayName,
      });

      return {
        ok: true,
        result: {
          decision: classification.icpFit ? "fit" : "not_fit",
          icpFit: classification.icpFit,
          confidence: classification.confidence,
          reason: classification.reason,
          suggestedContactName: classification.suggestedContactName,
          suggestedCompany: classification.suggestedCompany,
          email,
          displayName,
          domain,
          isConsumerDomain: CONSUMER_DOMAINS.has(domain),
        },
      };
    },
  };

  const materialize: Tool = {
    name: "leads.materialize",
    description:
      "Create contact + (non-consumer-domain) company for an ICP-fit sender. NEVER creates a deal — phase 4 owns deal creation. Idempotent: returns the existing contactId if one already exists for this email.",
    inputs: z.object({
      itemId: z.string().uuid(),
      classification: z
        .object({
          icpFit: z.boolean(),
          confidence: z.number(),
          reason: z.string(),
          suggestedContactName: z.string().nullable().optional(),
          suggestedCompany: z.string().nullable().optional(),
        })
        .optional(),
    }),
    async handler(
      input: {
        itemId: string;
        classification?: {
          icpFit: boolean;
          confidence: number;
          reason: string;
          suggestedContactName?: string | null;
          suggestedCompany?: string | null;
        };
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = (await deps.db.execute(sql`
        SELECT id, "from", subject, metadata
        FROM inbox_items
        WHERE id = ${input.itemId} AND tenant_id = ${ctx.tenantId}
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        from: string | null;
        subject: string | null;
        metadata: Record<string, unknown> | null;
      }>;
      const item = rows[0];
      if (!item) {
        return {
          ok: false,
          error: { code: "not_found", message: "Inbox item not found", retryable: false },
        };
      }

      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      const lens = (meta.crmLens ?? {}) as Record<string, unknown>;
      const existingContact = (lens.contactMatch ?? null) as
        | { id?: string }
        | null;
      if (existingContact?.id) {
        return {
          ok: true,
          result: {
            contactId: existingContact.id,
            companyId: null,
            created: false,
            skipped: true,
            skipReason: "already_linked",
          },
        };
      }

      const { email, displayName } = parseFromHeader(item.from);
      if (!email) {
        return {
          ok: true,
          result: {
            contactId: null,
            companyId: null,
            created: false,
            skipped: true,
            skipReason: "unparseable_from",
          },
        };
      }

      // Idempotency: re-resolve by email to avoid creating duplicates
      // when the workflow fires multiple times for the same item.
      const dupe = (await deps.db.execute(sql`
        SELECT id, company_id FROM crm__contacts
        WHERE tenant_id = ${ctx.tenantId} AND lower(email) = ${email}
        LIMIT 1
      `)) as unknown as Array<{ id: string; company_id: string | null }>;
      if (dupe[0]) {
        // Backfill the lens pointer so future tools can find it.
        await deps.db.execute(sql`
          UPDATE inbox_items
          SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            crmLens: {
              contactMatch: { id: dupe[0].id, autoCreated: false },
              companyMatch: dupe[0].company_id ? { id: dupe[0].company_id } : null,
            },
          })}::jsonb
          WHERE id = ${input.itemId} AND tenant_id = ${ctx.tenantId}
        `);
        return {
          ok: true,
          result: {
            contactId: dupe[0].id,
            companyId: dupe[0].company_id,
            created: false,
            skipped: true,
            skipReason: "duplicate_email",
          },
        };
      }

      const result = await qualifyAndCreateLead(deps, ctx.tenantId, {
        email,
        displayName,
        suggestedContactName: input.classification?.suggestedContactName ?? null,
        suggestedCompany: input.classification?.suggestedCompany ?? null,
        classification: input.classification
          ? {
              icpFit: input.classification.icpFit,
              confidence: input.classification.confidence,
              reason: input.classification.reason,
            }
          : undefined,
      });

      if (result.contactId) {
        await deps.db.execute(sql`
          UPDATE inbox_items
          SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            crmLens: {
              contactMatch: { id: result.contactId, autoCreated: true },
              companyMatch: result.companyId ? { id: result.companyId } : null,
            },
          })}::jsonb
          WHERE id = ${input.itemId} AND tenant_id = ${ctx.tenantId}
        `);

        // Also log a Received: activity now that we have a contact id.
        await logActivity({
          db: deps.db,
          tenantId: ctx.tenantId,
          type: "email",
          subject: `Received: ${item.subject ?? "(no subject)"}`,
          contactId: result.contactId,
          companyId: result.companyId,
        });
      }

      return { ok: true, result };
    },
  };

  const scanNoise: Tool = {
    name: "leads.scan_noise",
    description:
      "Read-only scan for auto-created contacts/companies/deals that look like noise (newsletters, bot senders, all-noise triage). Returns candidates with reasons. Used by the crm-maintenance agent.",
    inputs: z.object({}),
    async handler(
      _input: Record<string, never>,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const rows = (await deps.db.execute(sql`
        SELECT
          c.id AS contact_id,
          c.first_name,
          c.last_name,
          c.email,
          c.company_id,
          c.custom_fields,
          (SELECT count(*)::int FROM crm__activities a
             WHERE a.tenant_id = ${ctx.tenantId}
               AND a.contact_id = c.id
               AND a.type = 'email'
               AND a.subject ILIKE 'Sent:%') AS outbound_count,
          (SELECT count(*)::int FROM crm__activities a2
             WHERE a2.tenant_id = ${ctx.tenantId}
               AND a2.contact_id = c.id
               AND a2.subject NOT ILIKE 'Re-engaged%') AS total_activities
        FROM crm__contacts c
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.source = 'inbox-auto'
        ORDER BY c.created_at DESC
      `)) as unknown as Array<{
        contact_id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        company_id: string | null;
        custom_fields: Record<string, unknown> | null;
        outbound_count: number;
        total_activities: number;
      }>;

      type Candidate = {
        contactId: string;
        contactEmail: string | null;
        contactName: string;
        companyId: string | null;
        dealId: string | null;
        reasons: string[];
      };

      const candidates: Candidate[] = [];
      for (const r of rows) {
        if (r.outbound_count > 0) continue;
        const customFields = (r.custom_fields ?? {}) as Record<string, unknown>;
        const hasMeaningfulFields =
          Object.keys(customFields).filter((k) => k !== "leadClassification").length > 0;
        if (hasMeaningfulFields) continue;

        const reasons: string[] = [];
        const email = r.email ?? "";
        const [local, domain] = email.split("@");

        if (local && isBotLocal(local)) {
          reasons.push(`Sender local-part looks bot-y: ${local}`);
        }

        // All inbox items linked to this contact tagged as noise?
        const noiseCheck = (await deps.db.execute(sql`
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE (metadata->'triage'->>'label') = 'noise')::int AS noise
          FROM inbox_items
          WHERE tenant_id = ${ctx.tenantId}
            AND (
              (metadata->'crmLens'->'contactMatch'->>'id') = ${r.contact_id}
              OR lower("from") LIKE ${"%<" + email + ">%"}
              OR lower("from") = ${email}
            )
        `)) as unknown as Array<{ total: number; noise: number }>;
        const total = noiseCheck[0]?.total ?? 0;
        const noise = noiseCheck[0]?.noise ?? 0;
        if (total > 0 && total === noise) {
          reasons.push(`All ${total} linked inbox item(s) classified as noise`);
        }

        const classification = (customFields.leadClassification ?? null) as
          | { confidence?: number; reason?: string }
          | null;
        if (classification && typeof classification.confidence === "number") {
          if (classification.confidence < 0.4) {
            reasons.push(
              `Low-confidence auto-create (${classification.confidence.toFixed(2)}): ${classification.reason ?? "(no reason recorded)"}`,
            );
          }
        }

        // Bulk-mail-provider domains (very common false positive sources).
        const BULK_DOMAINS = [
          "mailchimp.com",
          "sendgrid.net",
          "campaign-archive.com",
          "amazonses.com",
          "substack.com",
        ];
        if (domain && BULK_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) {
          reasons.push(`Bulk-email provider domain: ${domain}`);
        }

        if (reasons.length === 0 && r.total_activities <= 1) {
          // No clear noise signal but also no human engagement — surface
          // as a low-priority candidate.
          reasons.push("No outbound activity, no custom fields");
        }

        if (reasons.length === 0) continue;

        // Find any open deal so the agent can decide whether to delete it too.
        const dealRows = (await deps.db.execute(sql`
          SELECT id FROM crm__deals
          WHERE tenant_id = ${ctx.tenantId}
            AND contact_id = ${r.contact_id}
          LIMIT 1
        `)) as unknown as Array<{ id: string }>;

        candidates.push({
          contactId: r.contact_id,
          contactEmail: r.email,
          contactName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || (r.email ?? ""),
          companyId: r.company_id,
          dealId: dealRows[0]?.id ?? null,
          reasons,
        });
      }

      // Companies with no remaining contacts are also fair game.
      // We compare against the set of candidate contact ids; if the list
      // is empty, we simply ask "are there ANY contacts on this company?"
      const candidateIds = candidates.map((c) => c.contactId);
      const excludeClause =
        candidateIds.length > 0
          ? sql`AND c.id::text NOT IN (${sql.join(candidateIds.map((id) => sql`${id}`), sql`, `)})`
          : sql``;
      const orphanCompanies = (await deps.db.execute(sql`
        SELECT co.id, co.name
        FROM crm__companies co
        WHERE co.tenant_id = ${ctx.tenantId}
          AND NOT EXISTS (
            SELECT 1 FROM crm__contacts c
            WHERE c.tenant_id = ${ctx.tenantId}
              AND c.company_id = co.id
              ${excludeClause}
          )
        ORDER BY co.created_at DESC
      `)) as unknown as Array<{ id: string; name: string | null }>;

      return {
        ok: true,
        result: {
          candidates,
          orphanCompanies,
          totals: {
            contacts: candidates.length,
            companies: orphanCompanies.length,
            deals: candidates.filter((c) => c.dealId).length,
          },
        },
      };
    },
  };

  const deleteNoise: Tool = {
    name: "leads.delete_noise",
    description:
      "Cascading delete of explicit contact / company / deal ids. Deletes deals first, then contacts, then companies only if no other contacts remain on them. Writes audit note activities before deletion.",
    inputs: z.object({
      contactIds: z.array(z.string().uuid()).default([]),
      companyIds: z.array(z.string().uuid()).default([]),
      dealIds: z.array(z.string().uuid()).default([]),
    }),
    async handler(
      input: { contactIds: string[]; companyIds: string[]; dealIds: string[] },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      let dealsDeleted = 0;
      let contactsDeleted = 0;
      let companiesDeleted = 0;

      for (const dealId of input.dealIds) {
        const exists = (await deps.db.execute(sql`
          SELECT id FROM crm__deals WHERE id = ${dealId} AND tenant_id = ${ctx.tenantId} LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        if (!exists[0]) continue;
        await logActivity({
          db: deps.db,
          tenantId: ctx.tenantId,
          type: "note",
          subject: "Deal deleted by maintenance cleanup",
          dealId,
        });
        await deps.db.execute(sql`
          DELETE FROM crm__activities WHERE deal_id = ${dealId} AND tenant_id = ${ctx.tenantId}
        `);
        await deps.db.execute(sql`
          DELETE FROM crm__deals WHERE id = ${dealId} AND tenant_id = ${ctx.tenantId}
        `);
        dealsDeleted++;
        emitCrm(deps, "entity.deleted", ctx.tenantId, {
          entityType: "crm_deal",
          entityId: dealId,
        });
      }

      for (const contactId of input.contactIds) {
        const exists = (await deps.db.execute(sql`
          SELECT id, company_id FROM crm__contacts WHERE id = ${contactId} AND tenant_id = ${ctx.tenantId} LIMIT 1
        `)) as unknown as Array<{ id: string; company_id: string | null }>;
        if (!exists[0]) continue;
        await logActivity({
          db: deps.db,
          tenantId: ctx.tenantId,
          type: "note",
          subject: "Contact deleted by maintenance cleanup",
          contactId,
          companyId: exists[0].company_id,
        });
        // Cascade open deals owned by this contact (if not already explicitly listed).
        const ownedDeals = (await deps.db.execute(sql`
          SELECT id FROM crm__deals WHERE contact_id = ${contactId} AND tenant_id = ${ctx.tenantId}
        `)) as unknown as Array<{ id: string }>;
        for (const d of ownedDeals) {
          await deps.db.execute(sql`
            DELETE FROM crm__activities WHERE deal_id = ${d.id} AND tenant_id = ${ctx.tenantId}
          `);
          await deps.db.execute(sql`
            DELETE FROM crm__deals WHERE id = ${d.id} AND tenant_id = ${ctx.tenantId}
          `);
          dealsDeleted++;
          emitCrm(deps, "entity.deleted", ctx.tenantId, {
            entityType: "crm_deal",
            entityId: d.id,
          });
        }
        await deps.db.execute(sql`
          DELETE FROM crm__activities WHERE contact_id = ${contactId} AND tenant_id = ${ctx.tenantId}
        `);
        await deps.db.execute(sql`
          DELETE FROM crm__contacts WHERE id = ${contactId} AND tenant_id = ${ctx.tenantId}
        `);
        contactsDeleted++;
        emitCrm(deps, "entity.deleted", ctx.tenantId, {
          entityType: "crm_contact",
          entityId: contactId,
        });
      }

      for (const companyId of input.companyIds) {
        const remaining = (await deps.db.execute(sql`
          SELECT count(*)::int AS n FROM crm__contacts
          WHERE company_id = ${companyId} AND tenant_id = ${ctx.tenantId}
        `)) as unknown as Array<{ n: number }>;
        if ((remaining[0]?.n ?? 0) > 0) continue;
        await logActivity({
          db: deps.db,
          tenantId: ctx.tenantId,
          type: "note",
          subject: "Company deleted by maintenance cleanup (no remaining contacts)",
          companyId,
        });
        await deps.db.execute(sql`
          DELETE FROM crm__activities WHERE company_id = ${companyId} AND tenant_id = ${ctx.tenantId}
        `);
        await deps.db.execute(sql`
          DELETE FROM crm__companies WHERE id = ${companyId} AND tenant_id = ${ctx.tenantId}
        `);
        companiesDeleted++;
        emitCrm(deps, "entity.deleted", ctx.tenantId, {
          entityType: "crm_company",
          entityId: companyId,
        });
      }

      return {
        ok: true,
        result: {
          deleted: {
            deals: dealsDeleted,
            contacts: contactsDeleted,
            companies: companiesDeleted,
          },
        },
      };
    },
  };

  return [classifyAndCreate, materialize, scanNoise, deleteNoise];
}
