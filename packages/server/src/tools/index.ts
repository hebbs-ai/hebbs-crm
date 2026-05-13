// Aggregates every CRM tool factory. Each entity-specific file
// exports a `create<Group>Tools(deps): Tool[]` function; this
// module flattens them into a single array passed to
// `Module.tools` in module.ts.
//
// Tool dispatch URL pattern: /api/tools/crm.<group>.<verb>
//   crm.contacts.list, crm.deals.update, crm.inbox.reply, etc.

import type { Tool } from "@boringos/module-sdk";
import { createContactTools } from "./contacts.js";
import { createCompanyTools } from "./companies.js";
import { createDealTools } from "./deals.js";
import { createPipelineTools } from "./pipelines.js";
import { createActivityTools } from "./activities.js";
import { createInboxTools } from "./inbox.js";
import { createProfileTools } from "./profile.js";
import { createActionTools } from "./actions.js";
import { createCalendarTools } from "./calendar.js";
import { createRoutineTools } from "./routines.js";
import { createLeadTools } from "./leads.js";
import { createMaintenanceTools } from "./maintenance.js";
import type { CrmDeps } from "./deps.js";

export function createCrmTools(deps: CrmDeps): Tool[] {
  return [
    ...createContactTools(deps),
    ...createCompanyTools(deps),
    ...createDealTools(deps),
    ...createPipelineTools(deps),
    ...createActivityTools(deps),
    ...createInboxTools(deps),
    ...createProfileTools(deps),
    ...createActionTools(deps),
    ...createCalendarTools(deps),
    ...createRoutineTools(deps),
    ...createLeadTools(deps),
    ...createMaintenanceTools(deps),
  ];
}
