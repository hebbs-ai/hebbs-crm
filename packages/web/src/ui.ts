// SPDX-License-Identifier: GPL-3.0-or-later
//
// CRM PluginUI export — task_19 contract.
//
// The shell's `pluginHost` registers this at boot via
// modules.config.ts. Each contribution becomes a real Route /
// sidebar entry / entity panel / settings panel, gated per-tenant
// by useInstalledModules() (set by the framework's install-manager).
//
// Side-effect import of the CRM stylesheet — Vite library mode
// only emits a CSS asset if something in the entry graph imports
// CSS. The shell's runtime-loader injects /modules/crm/ui/index.css
// as a <link> when the bundle registers, so Tailwind utilities
// (incl. @theme tokens) ship with the bundle.

import "./index.css";

import type { PluginUI } from "@boringos/ui";

import { PipelineSlot } from "./slots/Pipeline.js";
import { DealsSlot } from "./slots/Deals.js";
import { DealDetailSlot } from "./slots/DealDetail.js";
import { ContactsSlot } from "./slots/Contacts.js";
import { ContactDetailSlot } from "./slots/ContactDetail.js";
import { CompaniesSlot } from "./slots/Companies.js";
import { CompanyDetailSlot } from "./slots/CompanyDetail.js";
import { PipelineSettingsSlot } from "./slots/PipelineSettings.js";
import { MaintenanceSettingsSlot } from "./slots/MaintenanceSettings.js";
import {
  sendFollowup,
  runAnalyst,
  markWon,
  markLost,
} from "./slots/dealActions.js";
import { DealsClosingThisWeekWidget } from "./dashboard/DealsClosingThisWeek.js";
import { PipelineByStageWidget } from "./dashboard/PipelineByStage.js";

export const crmUI: PluginUI = {
  moduleId: "crm",
  displayName: "CRM",
  navItems: [
    // Sidebar entries (list pages). Paths are flat — the existing
    // CRM in-page <Link to="/deals/<id>"> components already use
    // unnamespaced paths, so we mount on the same shape.
    { id: "pipeline",  label: "Pipeline",  path: "/pipeline",  element: PipelineSlot,  order: 10 },
    { id: "deals",     label: "Deals",     path: "/deals",     element: DealsSlot,     order: 20 },
    { id: "contacts",  label: "Contacts",  path: "/contacts",  element: ContactsSlot,  order: 30 },
    { id: "companies", label: "Companies", path: "/companies", element: CompaniesSlot, order: 40 },
    // Hidden entity-detail routes (linked from the list pages).
    { id: "deal-detail",    label: "Deal",    path: "/deals/:id",     element: DealDetailSlot,    hidden: true },
    { id: "contact-detail", label: "Contact", path: "/contacts/:id",  element: ContactDetailSlot, hidden: true },
    { id: "company-detail", label: "Company", path: "/companies/:id", element: CompanyDetailSlot, hidden: true },
  ],
  entityPanels: [
    { entityKind: "crm_deal",    id: "overview", label: "Overview", element: DealDetailSlot,    order: 0 },
    { entityKind: "crm_contact", id: "overview", label: "Overview", element: ContactDetailSlot, order: 0 },
    { entityKind: "crm_company", id: "overview", label: "Overview", element: CompanyDetailSlot, order: 0 },
  ],
  entityActions: [
    { entityKind: "crm_deal", id: "send-followup", label: "Send follow-up", invoke: sendFollowup.invoke },
    { entityKind: "crm_deal", id: "run-analyst",   label: "Run analyst",    invoke: runAnalyst.invoke },
    { entityKind: "crm_deal", id: "mark-won",      label: "Mark won",       invoke: markWon.invoke,
      visible: markWon.visible },
    { entityKind: "crm_deal", id: "mark-lost",     label: "Mark lost",      invoke: markLost.invoke,
      visible: markLost.visible },
  ],
  settingsPanels: [
    { id: "crm.pipeline", label: "Pipeline configuration", element: PipelineSettingsSlot },
    { id: "crm.maintenance", label: "Maintenance", element: MaintenanceSettingsSlot },
  ],
  dashboardWidgets: [
    {
      id: "pipeline-by-stage",
      title: "Pipeline by stage",
      size: "medium",
      slot: "secondary",
      element: PipelineByStageWidget,
      order: 100,
    },
    {
      id: "deals-closing-this-week",
      title: "Closing this week",
      size: "medium",
      slot: "secondary",
      element: DealsClosingThisWeekWidget,
      order: 110,
    },
  ],
  // MDK T8.4 — Copilot tools the shell surfaces in its tool picker.
  // Each entry must be a tool the CRM has actually registered on the
  // server; the framework's permission check (per-tenant module
  // install) gates execution.
  copilotTools: [
    { toolName: "crm.contacts.list",  label: "List contacts" },
    { toolName: "crm.contacts.create", label: "Create contact" },
    { toolName: "crm.companies.list", label: "List companies" },
    { toolName: "crm.deals.list",     label: "List deals" },
    { toolName: "crm.deals.create",   label: "Create deal" },
    { toolName: "crm.activities.list", label: "List activities" },
  ],
  // MDK T8.4 — inbox filters narrow the inbox to CRM-relevant items
  // by checking source / metadata. Each filter is a pure predicate so
  // the shell can apply it client-side without a round-trip.
  inboxFilters: [
    {
      id: "crm-emails",
      label: "CRM emails",
      match: (item) => item.source === "gmail",
    },
    {
      id: "crm-deals",
      label: "Deal events",
      match: (item) =>
        Boolean(
          item.metadata &&
            typeof item.metadata === "object" &&
            "crm_kind" in item.metadata &&
            (item.metadata as Record<string, unknown>).crm_kind === "deal",
        ),
    },
  ],
};

export default crmUI;
