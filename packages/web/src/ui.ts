// SPDX-License-Identifier: BUSL-1.1
//
// L4 — CRM UIDefinition entry point.
//
// The shell loads this module from `manifest.ui.entry`
// ("packages/web/dist/ui.js"). The default export's `pages` map
// connects each manifest `ui.nav[].id` to the React component the
// shell mounts inside its Layout chrome.
//
// First slot port: `pipeline`. L5-L7 add deals/contacts/companies.

import { defineUI } from "@boringos/app-sdk";

import { PipelineSlot } from "./slots/Pipeline.js";
import { DealsSlot } from "./slots/Deals.js";
import { DealDetailSlot } from "./slots/DealDetail.js";
import { ContactsSlot } from "./slots/Contacts.js";
import { ContactDetailSlot } from "./slots/ContactDetail.js";
import { CompaniesSlot } from "./slots/Companies.js";
import { CompanyDetailSlot } from "./slots/CompanyDetail.js";
import {
  sendFollowup,
  runAnalyst,
  markWon,
  markLost,
} from "./slots/dealActions.js";
import { PipelineSettingsSlot } from "./slots/PipelineSettings.js";

export const crmUI = defineUI({
  pages: {
    pipeline: { id: "pipeline", component: PipelineSlot },
    deals: { id: "deals", component: DealsSlot },
    contacts: { id: "contacts", component: ContactsSlot },
    companies: { id: "companies", component: CompaniesSlot },
  },
  entityDetailPanels: {
    "crm_deal.detail": {
      id: "crm_deal.detail",
      entity: "crm_deal",
      label: "Overview",
      order: 0,
      component: DealDetailSlot as never,
    },
    "crm_contact.detail": {
      id: "crm_contact.detail",
      entity: "crm_contact",
      label: "Overview",
      order: 0,
      component: ContactDetailSlot as never,
    },
    "crm_company.detail": {
      id: "crm_company.detail",
      entity: "crm_company",
      label: "Overview",
      order: 0,
      component: CompanyDetailSlot as never,
    },
  },
  entityActions: {
    // Cast to the SDK's invariant Record<string, EntityAction<string>>
    // shape — our typed crm_deal actions are functionally compatible
    // but contravariance on `visible(entity)` blocks structural
    // assignment.
    "send-followup": sendFollowup as never,
    "run-analyst": runAnalyst as never,
    "mark-won": markWon as never,
    "mark-lost": markLost as never,
  },
  settingsPanels: {
    "pipeline-config": {
      id: "pipeline-config",
      label: "Pipeline configuration",
      component: PipelineSettingsSlot,
    },
  },
});

export default crmUI;
