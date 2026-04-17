import { agentDocs as contactsDocs } from "../routes/contacts.js";
import { agentDocs as companiesDocs } from "../routes/companies.js";
import { agentDocs as dealsDocs } from "../routes/deals.js";
import { agentDocs as pipelinesDocs } from "../routes/pipelines.js";
import { agentDocs as activitiesDocs } from "../routes/activities.js";
import { agentDocs as inboxDocs } from "../routes/inbox.js";
import { agentDocs as memoryDocs } from "../routes/memory.js";
import { agentDocs as profileDocs } from "../routes/profile.js";

/**
 * Combined agent-facing docs for the /api/crm mount. Pass to
 * `app.route("/api/crm", routes, { agentDocs: crmAgentDocs })` — the
 * framework's built-in api-catalog context provider injects this into
 * every agent run's system prompt.
 *
 * Each route module owns its own `agentDocs(url)` export; this aggregator
 * just concatenates them. When adding a new route group, import its
 * `agentDocs` here.
 */
export function crmAgentDocs(callbackUrl: string): string {
  const sections = [
    contactsDocs(callbackUrl),
    companiesDocs(callbackUrl),
    dealsDocs(callbackUrl),
    pipelinesDocs(callbackUrl),
    activitiesDocs(callbackUrl),
    inboxDocs(callbackUrl),
    memoryDocs(callbackUrl),
    profileDocs(callbackUrl),
  ].join("\n\n");

  return `You are the copilot for a CRM application. You have access to the following data and endpoints. Every call requires the \`X-Tenant-Id\` header (use \`$BORINGOS_TENANT_ID\` — the env var is injected into your subprocess).

Money is stored in cents. Dates are ISO-8601. IDs are UUIDs.

#### Entities & Endpoints

${sections}

#### How to Answer CRM Questions

1. Query the relevant endpoint(s) to get current data.
2. Analyze the results.
3. Present a clear, concise answer with specific numbers and entity names.
4. If the user asks you to create or update something, call the appropriate endpoint and confirm what you did.

Examples:
- "Show my deals closing this month" → GET /deals, filter by expectedCloseDate
- "What's my pipeline worth?" → GET /pipelines/ID/forecast
- "Create a deal for Acme, $50k" → POST /deals with \`value: 5000000\`
- "Move the Stripe deal to negotiation" → find the deal, GET /pipelines/ID to look up the stage ID, PUT /deals/ID
- "Reply to that email from Sarah" → POST /inbox/ITEM_ID/reply
- "What do we know about this prospect?" → GET /contacts/ID, check \`customFields.dossier\` before asking the user`;
}
