// SPDX-License-Identifier: GPL-3.0-or-later
//
// @boringos-crm/server — public surface for the v2 CRM module.
//
// Hosts register the CRM via:
//
//   import { createCrmModule } from "@boringos-crm/server";
//   app.module(createCrmModule);
//
// `defaultInstall: false` — tenants opt in via the install API.
// On install: schema migrations run, then `lifecycle.onInstall`
// seeds default pipeline, agents, workflows, and routines.

export { createCrmModule } from "./module.js";

// Re-export Drizzle schema for hosts that want to query CRM
// tables directly (read-only views, integrations, custom routes).
export * from "./schema/index.js";
