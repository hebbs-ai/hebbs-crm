// SPDX-License-Identifier: GPL-3.0-or-later
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
import type { CrmDeps, CrmEventBus, GetConnectorToken } from "./tools/deps.js";

const __moduleDir = dirname(fileURLToPath(import.meta.url));

export const createCrmModule: ModuleFactory = (factoryDeps) => {
  // `db` stays `unknown` in `ModuleFactoryDeps` so the SDK can avoid
  // a Drizzle dep (T0.4 audit). The cast is the deliberate seam.
  const db = factoryDeps.db as PostgresJsDatabase;

  // MDK T3.5 — `eventBus` is now typed as the SDK's `EventBus` (T3.1c).
  // CRM's local `CrmEventBus` shim is a structural supertype, so no
  // cast is required. The shim itself retires in T8.1.
  const getEventBus = (): CrmEventBus | null =>
    factoryDeps.eventBus ?? null;

  // `getConnectorToken` is typed by module-sdk (T0.3 / #60) — no cast
  // needed; the `??` falls back to a null-returning stub so tools
  // degrade gracefully on a host without an AuthManager (e.g. early
  // test harnesses).
  const getConnectorToken: GetConnectorToken =
    factoryDeps.getConnectorToken ?? (async () => null);

  const deps: CrmDeps = { db, getEventBus, getConnectorToken };

  const module: Module = {
    id: "crm",
    name: "CRM",
    // T8.2 — module.json on disk is trimmed to pack-time-only fields
    // (entry, ui, publisher, license, minFrameworkVersion). Everything
    // else flows from this factory through pack-hebbsmod's
    // mergeManifest. Single source of truth = the factory.
    version: "0.3.0",
    description:
      "Sales CRM — contacts, companies, deals, pipelines, activities. Ships specialised agents for triage, enrichment, deal analysis, follow-up writing, and meeting prep.",
    kind: "module",
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
