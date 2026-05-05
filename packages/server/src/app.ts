// SPDX-License-Identifier: BUSL-1.1
//
// L2 — CRM AppDefinition.
//
// Wraps the CRM's existing server pieces (agents, workflows, routes,
// onTenantCreated, context providers) into the `defineApp({...})` shape
// the BoringOS framework's install pipeline (K7) consumes. The
// standalone server entry (index.ts) still works — this is additive.
//
// Two exports:
//   - `crmAppStatic`  — the static portions of the AppDefinition that
//                       don't need a runtime context (id, agents,
//                       workflows). Useful for tests + manifest
//                       validation that don't boot the full server.
//   - `createCrmApp(ctx)` — factory producing the full AppDefinition
//                       with `routes` + `onTenantCreated` closures
//                       bound to a CrmContext. The kernel install
//                       (K7) will call this with a kernel-supplied
//                       CrmContext at install time.

import { defineApp, type AgentDefinition, type AppDefinition, type RouteRegistrar, type WorkflowTemplate } from "@boringos/app-sdk";
import { createAuthMiddleware } from "@boringos/core";
import { Hono } from "hono";

import { EMAIL_LENS_INSTRUCTIONS } from "./agents/email-lens.js";
import { CONTACT_DOSSIER_INSTRUCTIONS } from "./agents/enrichment-contact.js";
import { COMPANY_DOSSIER_INSTRUCTIONS } from "./agents/enrichment-company.js";
import { DEAL_ANALYST_INSTRUCTIONS } from "./agents/deal-analyst.js";
import { FOLLOW_UP_WRITER_INSTRUCTIONS } from "./agents/follow-up-writer.js";

import { createCrmRoutes } from "./routes/index.js";
import { crmAgentDocs } from "./context-providers/crm-schema.js";
import { provisionCrmTenant } from "./tenant.js";
import type { CrmContext } from "./context.js";

/* ── Agents ──────────────────────────────────────────────────────────── */

export const crmAgents: AgentDefinition[] = [
  {
    // L10 — replaces the prior crm.email-triage agent. The lens
    // subscribes to triage.classified and never re-classifies.
    id: "crm.email-lens",
    name: "CRM Email Lens",
    persona: "researcher",
    runtime: "claude",
    instructions: EMAIL_LENS_INSTRUCTIONS,
  },
  {
    id: "crm.contact-enrichment",
    name: "Contact Enrichment",
    persona: "researcher",
    runtime: "claude",
    instructions: CONTACT_DOSSIER_INSTRUCTIONS,
  },
  {
    id: "crm.company-enrichment",
    name: "Company Enrichment",
    persona: "researcher",
    runtime: "claude",
    instructions: COMPANY_DOSSIER_INSTRUCTIONS,
  },
  {
    id: "crm.deal-analyst",
    name: "Deal Analyst",
    persona: "researcher",
    runtime: "claude",
    instructions: DEAL_ANALYST_INSTRUCTIONS,
  },
  {
    id: "crm.follow-up-writer",
    name: "Follow-up Writer",
    persona: "researcher",
    runtime: "claude",
    instructions: FOLLOW_UP_WRITER_INSTRUCTIONS,
  },
];

/* ── Workflows ───────────────────────────────────────────────────────── */
//
// Email Sync — fetch new gmail messages every 15 min, persist to inbox
// (which fires inbox.item_created → triage agent picks up).
//
// Calendar Check — fetch upcoming events every 30 min, emit
// calendar.upcoming_events (meeting-prep workflow listens).

export const crmWorkflows: WorkflowTemplate[] = [
  {
    id: "crm.email-lens-on-classified",
    name: "CRM lens on classified inbox items",
    description:
      "Wakes the CRM Email Lens agent on every triage.classified event so the CRM-specific interpretation (contact match, deal context, draft) layers on top of generic-triage's output.",
    blocks: [
      {
        id: "trigger",
        name: "trigger",
        type: "trigger",
        config: { eventType: "triage.classified" },
      },
      {
        id: "wake",
        name: "wake",
        type: "wake-agent",
        config: { agentId: "crm.email-lens", reason: "triage_classified" },
      },
    ],
    edges: [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 },
    ],
    triggers: [{ type: "event", event: "triage.classified" }],
  },
  {
    id: "crm.email-ingest",
    name: "Email Sync",
    description: "Fetch Gmail messages every 15 minutes and route them into the framework inbox.",
    blocks: [
      { id: "trigger", name: "trigger", type: "trigger", config: {} },
      {
        id: "fetch",
        name: "fetch",
        type: "connector-action",
        config: {
          connectorKind: "google",
          action: "list_emails",
          inputs: { maxResults: 20 },
        },
      },
      {
        id: "loop",
        name: "loop",
        type: "for-each",
        config: { items: "{{fetch.messages}}" },
      },
      {
        id: "store",
        name: "store",
        type: "create-inbox-item",
        config: { source: "gmail", items: "{{loop.items}}" },
      },
    ],
    edges: [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "fetch", targetBlockId: "loop", sourceHandle: null, sortOrder: 0 },
      { id: "e3", sourceBlockId: "loop", targetBlockId: "store", sourceHandle: null, sortOrder: 0 },
    ],
    triggers: [{ type: "cron", cron: "*/15 * * * *" }],
  },
  {
    id: "crm.calendar-check",
    name: "Calendar Check",
    description: "Fetch upcoming calendar events every 30 minutes and broadcast a calendar.upcoming_events bus event.",
    blocks: [
      { id: "trigger", name: "trigger", type: "trigger", config: {} },
      {
        id: "fetch",
        name: "fetch",
        type: "connector-action",
        config: {
          connectorKind: "google",
          action: "list_events",
          inputs: { maxResults: 10, timeMin: "NOW" },
        },
      },
      {
        id: "emit",
        name: "emit",
        type: "emit-event",
        config: {
          connectorKind: "calendar",
          eventType: "calendar.upcoming_events",
          data: { events: "{{fetch.events}}" },
        },
      },
    ],
    edges: [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "fetch", targetBlockId: "emit", sourceHandle: null, sortOrder: 0 },
    ],
    triggers: [{ type: "cron", cron: "*/30 * * * *" }],
  },
];

/* ── Static (no-context) AppDefinition ──────────────────────────────── */

/**
 * Static portions of the CRM AppDefinition. Useful for tests +
 * manifest validation that don't need a live CrmContext. Production
 * uses `createCrmApp(ctx)` which closes over a real context.
 */
export const crmAppStatic = defineApp({
  id: "crm",
  agents: crmAgents,
  workflows: crmWorkflows,
});

/* ── Factory: full AppDefinition with routes + onTenantCreated ──────── */

export interface CreateCrmAppArgs {
  context: CrmContext;
}

export function createCrmApp({ context }: CreateCrmAppArgs): AppDefinition {
  // Route registrar + agentDocs — wraps the existing CRM Hono routes
  // exactly as `index.ts` mounts them today.
  const routes: RouteRegistrar = (router) => {
    const sub = router as Hono;
    sub.use("/*", createAuthMiddleware(context.db as never));
    const crmRoutes = createCrmRoutes(context);
    sub.route("/", crmRoutes);
  };
  routes.agentDocs = crmAgentDocs;

  return defineApp({
    id: "crm",
    agents: crmAgents,
    workflows: crmWorkflows,
    routes,
    onTenantCreated: async (lifecycleCtx) => {
      // The SDK's Database is opaque; the framework hands us the live
      // Drizzle tx. The CRM provisioner expects a PostgresJsDatabase
      // shape (its existing tenant.ts contract).
      await provisionCrmTenant(
        lifecycleCtx.db as unknown as Parameters<typeof provisionCrmTenant>[0],
        lifecycleCtx.tenantId,
      );
    },
  });
}

/* ── Default export ─────────────────────────────────────────────────── */

/**
 * Default export — the factory. Production hosts call this with a
 * CrmContext to obtain a typed AppDefinition that the BoringOS
 * install pipeline (K7) installs end-to-end. Equivalent in spirit to
 * the static `crmAppStatic` plus the closure-bound routes/onTenantCreated.
 */
export default createCrmApp;
