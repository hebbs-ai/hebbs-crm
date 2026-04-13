import type { ContextProvider, ContextBuildEvent } from "@boringos/agent";

/**
 * Teaches the copilot about CRM data model and available API endpoints.
 * Injected into every copilot run's system prompt.
 */
export const crmSchemaProvider: ContextProvider = {
  name: "crm-schema",
  phase: "system",
  priority: 40,

  async provide(event: ContextBuildEvent): Promise<string> {
    const { callbackUrl } = event;
    const tenantId = "$BORINGOS_TENANT_ID";

    return `## CRM Data Model

You are the copilot for a CRM application. You have access to the following data.

### Entities

**Contacts** — people you sell to
- Fields: id, firstName, lastName, email, phone, title, companyId, linkedIn, source, tags, customFields
- A contact can belong to a company and be linked to deals

**Companies** — organizations you sell to
- Fields: id, name, domain, industry, size, website, address, customFields
- A company has many contacts and deals

**Deals** — sales opportunities
- Fields: id, title, value (in cents — divide by 100 for dollars), currency, pipelineId, stageId, probability, expectedCloseDate, contactId, companyId, lostReason, customFields
- Deals move through pipeline stages: Discovery → Qualified → Proposal → Negotiation → Closing → Won / Lost
- Value is stored in cents: $50,000 = 5000000

**Pipelines** — sales processes with stages
- Fields: id, name, isDefault
- Each pipeline has stages with: name, sortOrder, probability, type (open/won/lost)

**Activities** — timeline of interactions
- Fields: id, type (call/email/meeting/note/task), subject, body, contactId, dealId, companyId, occurredAt
- Activities are linked to contacts, deals, and/or companies

### CRM API

You can query and modify CRM data. Use \`X-Tenant-Id\` header for authentication.

**List entities:**
\`\`\`
curl -s ${callbackUrl}/api/crm/contacts?search=sarah -H "X-Tenant-Id: ${tenantId}"
curl -s ${callbackUrl}/api/crm/companies?search=stripe -H "X-Tenant-Id: ${tenantId}"
curl -s ${callbackUrl}/api/crm/deals?pipelineId=ID -H "X-Tenant-Id: ${tenantId}"
curl -s ${callbackUrl}/api/crm/pipelines -H "X-Tenant-Id: ${tenantId}"
curl -s ${callbackUrl}/api/crm/activities?dealId=ID -H "X-Tenant-Id: ${tenantId}"
\`\`\`

**Get single entity:**
\`\`\`
curl -s ${callbackUrl}/api/crm/contacts/ID -H "X-Tenant-Id: ${tenantId}"
curl -s ${callbackUrl}/api/crm/deals/ID -H "X-Tenant-Id: ${tenantId}"
\`\`\`

**Create entity:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/crm/contacts -H "X-Tenant-Id: ${tenantId}" -H "Content-Type: application/json" \\
  -d '{"firstName": "...", "lastName": "...", "email": "...", "title": "...", "companyId": "..."}'

curl -s -X POST ${callbackUrl}/api/crm/deals -H "X-Tenant-Id: ${tenantId}" -H "Content-Type: application/json" \\
  -d '{"title": "...", "value": 5000000, "pipelineId": "...", "stageId": "..."}'

curl -s -X POST ${callbackUrl}/api/crm/activities -H "X-Tenant-Id: ${tenantId}" -H "Content-Type: application/json" \\
  -d '{"type": "note", "subject": "...", "body": "...", "dealId": "...", "contactId": "..."}'
\`\`\`

**Update entity:**
\`\`\`
curl -s -X PUT ${callbackUrl}/api/crm/deals/ID -H "X-Tenant-Id: ${tenantId}" -H "Content-Type: application/json" \\
  -d '{"stageId": "NEW_STAGE_ID", "probability": 75}'
\`\`\`

**Pipeline forecast:**
\`\`\`
curl -s ${callbackUrl}/api/crm/pipelines/ID/forecast -H "X-Tenant-Id: ${tenantId}"
\`\`\`

### How to Answer CRM Questions

When the user asks about their CRM data:
1. Query the relevant API endpoint(s) to get current data
2. Analyze the results
3. Present a clear, concise answer with specific numbers and entity names
4. If the user asks you to create or update something, call the appropriate API and confirm what you did

Examples:
- "Show my deals closing this month" → query deals, filter by expectedCloseDate
- "What's my pipeline worth?" → call forecast endpoint
- "Create a deal for Acme, $50k" → POST to deals endpoint
- "Move the Stripe deal to negotiation" → find the deal, find the stage ID, PUT to update`;
  },
};
