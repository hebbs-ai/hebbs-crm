// SPDX-License-Identifier: BUSL-1.1
//
// L11 — @boringos-crm/server is now a *library*, not a standalone HTTP
// host. The standalone boot (which used to call `app.listen(3001)`)
// has been deleted: the BoringOS framework's install pipeline (K7)
// installs the AppDefinition end-to-end into a shell-hosted runtime.
//
// Library exports:
//   - createCrmApp(ctx)  — factory producing the typed AppDefinition
//                         with routes + onTenantCreated bound to the
//                         supplied CrmContext.
//   - crmAppStatic       — static portions of the AppDefinition
//                         (id, agents, workflows). Useful for tests +
//                         manifest validation.
//   - crmAgents          — AgentDefinition[] (5 agents).
//   - crmWorkflows       — WorkflowTemplate[] (3 templates).
//   - crmApp             — default export of app.ts (the factory).
//
// CRM routes, agents, schema, and tenant-provisioning logic still
// live in this package as the canonical implementation; only the
// HTTP-server entry has been removed.

export {
  createCrmApp,
  crmAppStatic,
  crmAgents,
  crmWorkflows,
} from "./app.js";
export { default as crmApp } from "./app.js";

// Re-export the building blocks the host pulls in directly when not
// using the kernel install path (one-off scripts, tests, etc.).
export { createCrmRoutes } from "./routes/index.js";
export { createCrmContext } from "./context.js";
export type { CrmContext } from "./context.js";
export { provisionCrmTenant } from "./tenant.js";
export { crmAgentDocs } from "./context-providers/crm-schema.js";
