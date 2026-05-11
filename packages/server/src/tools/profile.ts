// CRM company-profile tools — get / update.
//
// Storage: per-field rows in the framework `tenant_settings` table
// keyed `company_<field>`. Same shape the v1 routes used, so the
// data file is interchangeable between v1 and v2 deployments.
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

export function createProfileTools(deps: CrmDeps): Tool[] {
  const get: Tool = {
    name: "profile.get",
    description:
      "Fetch the company profile (name, description, ICP, differentiators, etc.) for the current tenant. Returns a flat object with all known fields; missing fields come back as null.",
    inputs: z.object({}),
    async handler(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
      const result = await deps.db.execute(sql`
        SELECT key, value FROM tenant_settings
        WHERE tenant_id = ${ctx.tenantId} AND key LIKE 'company_%'
      `);
      const rows = result as unknown as Array<{ key: string; value: string | null }>;

      const profile: Profile = {
        company_name: null,
        company_description: null,
        company_products: null,
        company_icp: null,
        company_differentiators: null,
        company_competitors: null,
        company_methodology: null,
        company_tone: null,
      };
      for (const r of rows) {
        if ((PROFILE_FIELDS as readonly string[]).includes(r.key)) {
          profile[r.key as ProfileField] = r.value;
        }
      }

      return { ok: true, result: { data: profile } };
    },
  };

  const update: Tool = {
    name: "profile.update",
    description:
      "Update one or more fields on the company profile (name, description, products, ICP, differentiators, competitors, methodology, tone). Pass only the fields to change. Pass null to clear a field.",
    inputs: profileShape,
    async handler(input: ProfileInput, ctx: ToolContext): Promise<ToolResult> {
      const { randomUUID } = await import("node:crypto");

      for (const field of PROFILE_FIELDS) {
        // Only touch fields the caller actually supplied — undefined
        // means "leave it alone", null means "clear it".
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

      // Re-read so the caller gets the canonical post-update profile.
      const result = await deps.db.execute(sql`
        SELECT key, value FROM tenant_settings
        WHERE tenant_id = ${ctx.tenantId} AND key LIKE 'company_%'
      `);
      const finalRows = result as unknown as Array<{ key: string; value: string | null }>;

      const profile: Profile = {
        company_name: null,
        company_description: null,
        company_products: null,
        company_icp: null,
        company_differentiators: null,
        company_competitors: null,
        company_methodology: null,
        company_tone: null,
      };
      for (const r of finalRows) {
        if ((PROFILE_FIELDS as readonly string[]).includes(r.key)) {
          profile[r.key as ProfileField] = r.value;
        }
      }

      return { ok: true, result: { data: profile } };
    },
  };

  return [get, update];
}
