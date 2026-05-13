// CRM company-profile tools — get / update.
//
// As of the framework `business_profile` refactor, these tools are thin
// adapters: the canonical store is `tenant_settings.business_profile`
// (jsonb), owned by the framework's `tenant.get/update_business_profile`
// tools. We keep the 8-field response shape so existing callers
// (Copilot prompt builder, the CRM SPA dev page, any external scripts)
// don't break.
//
// Mapping:
//   company_description   <-> business_profile.whatWeDo
//   company_icp           <-> business_profile.idealCustomer
//   company_competitors   <-> business_profile.competitors[] (joined w/ \n)
//   company_tone          <-> business_profile.tone
// Fields without a 1:1 mapping (company_name, company_products,
// company_differentiators, company_methodology) keep living in
// per-key `tenant_settings.company_<field>` rows.
//
// Dispatched at /api/tools/crm.profile.<name>. tenantId comes from
// the JWT context.

import { z } from "@boringos/module-sdk";
import type { Tool, ToolContext, ToolResult } from "@boringos/module-sdk";
import { sql } from "drizzle-orm";
import { type CrmDeps } from "./deps.js";

const PROFILE_FIELDS = [
  "company_name",
  "company_description",
  "company_products",
  "company_icp",
  "company_differentiators",
  "company_competitors",
  "company_methodology",
  "company_tone",
] as const;

type ProfileField = (typeof PROFILE_FIELDS)[number];
type Profile = Record<ProfileField, string | null>;

const profileShape = z.object({
  company_name: z.string().nullable().optional(),
  company_description: z.string().nullable().optional(),
  company_products: z.string().nullable().optional(),
  company_icp: z.string().nullable().optional(),
  company_differentiators: z.string().nullable().optional(),
  company_competitors: z.string().nullable().optional(),
  company_methodology: z.string().nullable().optional(),
  company_tone: z.string().nullable().optional(),
});

type ProfileInput = z.infer<typeof profileShape>;

// Fields the framework profile owns. The rest still live as
// per-key `company_*` rows in `tenant_settings`.
const LEGACY_ONLY_FIELDS: ProfileField[] = [
  "company_name",
  "company_products",
  "company_differentiators",
  "company_methodology",
];

interface BusinessProfile {
  industry: string | null;
  whatWeDo: string | null;
  idealCustomer: string | null;
  signalExamples: string[];
  noiseExamples: string[];
  competitors: string[];
  tone: string | null;
}

function emptyProfile(): Profile {
  return {
    company_name: null,
    company_description: null,
    company_products: null,
    company_icp: null,
    company_differentiators: null,
    company_competitors: null,
    company_methodology: null,
    company_tone: null,
  };
}

function readBusinessProfile(raw: string | null | undefined): BusinessProfile | null {
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

function flatten(
  legacy: Record<string, string | null>,
  business: BusinessProfile | null,
): Profile {
  const out = emptyProfile();
  for (const field of PROFILE_FIELDS) {
    if (field in legacy) out[field] = legacy[field] ?? null;
  }
  if (business) {
    if (business.whatWeDo) out.company_description = business.whatWeDo;
    if (business.idealCustomer) out.company_icp = business.idealCustomer;
    if (business.competitors.length > 0) {
      out.company_competitors = business.competitors.join("\n");
    }
    if (business.tone) out.company_tone = business.tone;
  }
  return out;
}

async function loadProfile(deps: CrmDeps, tenantId: string): Promise<Profile> {
  const result = await deps.db.execute(sql`
    SELECT key, value FROM tenant_settings
    WHERE tenant_id = ${tenantId}
      AND (key LIKE 'company_%' OR key = 'business_profile')
  `);
  const rows = result as unknown as Array<{ key: string; value: string | null }>;
  const legacy: Record<string, string | null> = {};
  let businessRaw: string | null = null;
  for (const r of rows) {
    if (r.key === "business_profile") businessRaw = r.value;
    else legacy[r.key] = r.value;
  }
  return flatten(legacy, readBusinessProfile(businessRaw));
}

export function createProfileTools(deps: CrmDeps): Tool[] {
  const get: Tool = {
    name: "profile.get",
    description:
      "Fetch the company profile for the current tenant. Returns the 8 legacy fields (company_name, company_description, company_products, company_icp, company_differentiators, company_competitors, company_methodology, company_tone). Description, ICP, competitors, and tone are sourced from the framework `business_profile` when set; the rest from legacy `tenant_settings.company_*` rows.",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const profile = await loadProfile(deps, ctx.tenantId);
      return { ok: true, result: { data: profile } };
    },
  };

  const update: Tool = {
    name: "profile.update",
    description:
      "Update one or more fields on the company profile. Description, ICP, competitors, and tone write through to the framework `business_profile`; the rest write to legacy `tenant_settings.company_<field>` rows. Pass only fields to change; null clears a field.",
    inputs: profileShape,
    async handler(input: ProfileInput, ctx: ToolContext): Promise<ToolResult> {
      const { randomUUID } = await import("node:crypto");

      // 1) Legacy per-key rows.
      for (const field of LEGACY_ONLY_FIELDS) {
        if (!(field in input)) continue;
        const value = input[field] ?? null;
        const existing = await deps.db.execute(sql`
          SELECT id FROM tenant_settings
          WHERE tenant_id = ${ctx.tenantId} AND key = ${field}
          LIMIT 1
        `);
        const rows = existing as unknown as Array<{ id: string }>;
        if (rows[0]) {
          await deps.db.execute(sql`
            UPDATE tenant_settings
            SET value = ${value}, updated_at = now()
            WHERE id = ${rows[0].id}
          `);
        } else if (value !== null) {
          await deps.db.execute(sql`
            INSERT INTO tenant_settings (id, tenant_id, key, value)
            VALUES (${randomUUID()}, ${ctx.tenantId}, ${field}, ${value})
          `);
        }
      }

      // 2) Framework business_profile merge for the mapped fields.
      const mapsToBusiness =
        "company_description" in input ||
        "company_icp" in input ||
        "company_competitors" in input ||
        "company_tone" in input;

      if (mapsToBusiness) {
        const existingRows = await deps.db.execute(sql`
          SELECT id, value FROM tenant_settings
          WHERE tenant_id = ${ctx.tenantId} AND key = 'business_profile'
          LIMIT 1
        `);
        const eRows = existingRows as unknown as Array<{ id: string; value: string | null }>;
        const current = readBusinessProfile(eRows[0]?.value ?? null) ?? {
          industry: null,
          whatWeDo: null,
          idealCustomer: null,
          signalExamples: [],
          noiseExamples: [],
          competitors: [],
          tone: null,
        };

        const next: BusinessProfile = { ...current };
        if ("company_description" in input) next.whatWeDo = input.company_description ?? null;
        if ("company_icp" in input) next.idealCustomer = input.company_icp ?? null;
        if ("company_competitors" in input) {
          next.competitors = (input.company_competitors ?? "")
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        }
        if ("company_tone" in input) next.tone = input.company_tone ?? null;

        const serialized = JSON.stringify(next);
        if (eRows[0]) {
          await deps.db.execute(sql`
            UPDATE tenant_settings
            SET value = ${serialized}, updated_at = now()
            WHERE id = ${eRows[0].id}
          `);
        } else {
          await deps.db.execute(sql`
            INSERT INTO tenant_settings (id, tenant_id, key, value)
            VALUES (${randomUUID()}, ${ctx.tenantId}, 'business_profile', ${serialized})
          `);
        }
      }

      const profile = await loadProfile(deps, ctx.tenantId);
      return { ok: true, result: { data: profile } };
    },
  };

  return [get, update];
}
