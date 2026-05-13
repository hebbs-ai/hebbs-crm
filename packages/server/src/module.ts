// SPDX-License-Identifier: BUSL-1.1
//
// `crm` Module — v2 entry point. Exports `createCrmModule`, a
// ModuleFactory the host registers via `app.module(createCrmModule)`.
//
// Hybrid module: owns its own schema (`crm__*` tables), exposes
// CRUD tools at `/api/tools/crm.<group>.<verb>`, ships SKILL.md
// files for the CRM-specialised agents, and seeds default
// pipeline / agents / workflows / routines on install.
//
// `defaultInstall: false` — tenants opt in via the install API
// (Settings → Modules → Install CRM) which fires migrations +
// `lifecycle.onInstall`.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Module, ModuleFactory } from "@boringos/module-sdk";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { crmMigrations } from "./migrations.js";
import { createCrmTools } from "./tools/index.js";
import { createCrmLifecycle } from "./lifecycle.js";
import type { CrmDeps, CrmEventBus } from "./tools/deps.js";

const __moduleDir = dirname(fileURLToPath(import.meta.url));

export const createCrmModule: ModuleFactory = (factoryDeps) => {
  const db = factoryDeps.db as PostgresJsDatabase;
  const getEventBus = (): CrmEventBus | null =>
    (factoryDeps.eventBus ?? null) as CrmEventBus | null;

  const deps: CrmDeps = { db, getEventBus };

  const module: Module = {
    id: "crm",
    name: "CRM",
    version: "0.2.0",
    description:
      "Sales CRM — contacts, companies, deals, pipelines, activities. Ships specialised agents for triage, enrichment, deal analysis, follow-up writing, and meeting prep.",
    defaultInstall: false,
    provides: ["crm-source", "crm-actions"],
    dependsOn: [
      { capability: "email-send", optional: true },
      { capability: "file-storage", optional: true },
    ],
    schema: crmMigrations,
    tools: createCrmTools(deps),
    skills: [
      "./skills/email-lens/SKILL.md",
      "./skills/enrichment-contact/SKILL.md",
      "./skills/enrichment-company/SKILL.md",
      "./skills/deal-analyst/SKILL.md",
      "./skills/follow-up-writer/SKILL.md",
      "./skills/meeting-prep/SKILL.md",
      "./skills/copilot/SKILL.md",
      "./skills/maintenance/SKILL.md",
    ],
    lifecycle: createCrmLifecycle(factoryDeps),
    __moduleDir,
  };

  return module;
};
