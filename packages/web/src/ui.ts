// SPDX-License-Identifier: BUSL-1.1
//
// CRM PluginUI export — task_19 contract.
//
// The shell's `pluginHost` registers this at boot via
// modules.config.ts. Each contribution becomes a real Route /
// sidebar entry / entity panel / settings panel, gated per-tenant
// by useInstalledModules() (set by the framework's install-manager).

import type { PluginUI } from "@boringos/ui";

import { PipelineSlot } from "./slots/Pipeline.js";
import { DealsSlot } from "./slots/Deals.js";
import { DealDetailSlot } from "./slots/DealDetail.js";
import { ContactsSlot } from "./slots/Contacts.js";
import { ContactDetailSlot } from "./slots/ContactDetail.js";
import { CompaniesSlot } from "./slots/Companies.js";
import { CompanyDetailSlot } from "./slots/CompanyDetail.js";
import { PipelineSettingsSlot } from "./slots/PipelineSettings.js";
import {
  sendFollowup,
  runAnalyst,
  markWon,
  markLost,
} from "./slots/dealActions.js";

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
  ],
};

export default crmUI;
