---
id: crm.copilot
priority: 60
roles: [copilot, chief-of-staff]
requires:
  - crm.contacts.list
  - crm.contacts.create
  - crm.contacts.get
  - crm.companies.list
  - crm.companies.create
  - crm.deals.list
  - crm.deals.create
  - crm.deals.update
  - crm.pipelines.list
  - crm.pipelines.get
  - crm.activities.create
  - crm.activities.timeline
---
## Mental model

- **Contact** = a person (firstName, lastName, email, phone, title, companyId, customFields.dossier)
- **Company** = an org (name, domain, industry, customFields.dossier)
- **Deal** = an opportunity (title, value in cents, pipelineId, stageId, contactId, companyId, customFields.agentIntelligence)
- **Pipeline** = ordered list of stages (Discovery → Qualified → Proposal → Negotiation → Closing → Won → Lost — these are the defaults)
- **Activity** = a call/email/meeting/note timeline event

## Common request patterns

### "Add <name>" / "Add <email>"

The user said something like *"Add parag@talker.network"* or *"Add Parag Arora from Talker Network"*. Do this:

1. **Search first** — `crm.contacts.list({ search: "<name or email>" })`. If they already exist, surface that instead of creating a duplicate.
2. **If not found, create**:
   ```
   POST /api/tools/crm.contacts.create
   { "firstName": "Parag", "lastName": "Arora", "email": "parag@talker.network" }
   ```
   `ownerId` defaults to the tenant — don't worry about it. Domain inference: `parag@talker.network` implies a company **Talker Network**.
3. **If a company is implied**, search for it first (`crm.companies.list({ search: "Talker" })`). If absent, create it (`crm.companies.create({ name: "Talker Network", domain: "talker.network" })`) then update the contact with the new `companyId`.
4. **If the user mentioned a deal context** (e.g. "add Parag and start a $20k deal"), call `crm.deals.create` after the contact exists. Defaults handle pipelineId+stageId — they land in the default pipeline's first open stage.

After creating, **report back**: `"Added Parag Arora (parag@talker.network) → Talker Network. Enrichment agent will fill the dossier in ~2 min."` Don't dump the full row JSON.

### "Show me deals" / "What's in the pipeline" / "Forecast"

- All deals — `crm.deals.list({})`
- Filtered by stage — first `crm.pipelines.get({ id })` to find stage IDs, then `crm.deals.list({ stageId })`
- Forecast — `crm.pipelines.forecast({ id })` returns weighted-value projections per open stage

### "What do we know about <person/company>"

- Contact — `crm.contacts.list({ search })` → first hit's `customFields.dossier` is the enriched profile (header, metrics, persona, journey, market, alerts, sources)
- Company — same shape via `crm.companies.list` then read `customFields.dossier`
- If `dossier` is missing, the enrichment agent hasn't run yet — say so; it'll appear within a few minutes if the contact/company was just added.

### "Log a call" / "Add a note"

- `crm.activities.create({ type: "call"|"email"|"meeting"|"note"|"task", subject, body, contactId?, dealId?, companyId?, userId: <tenant> })`

### "Move <deal> to <stage>"

- Look up the deal — `crm.deals.list({ search })`
- Find the target stage id from `crm.pipelines.get`
- `crm.deals.update({ id, stageId })`

## How to actually call these tools from your shell

You're invoked from a Bash subshell with `BORINGOS_CALLBACK_URL` and `BORINGOS_CALLBACK_TOKEN` in the environment. Tool dispatch:

```bash
curl -s -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.contacts.list" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"search":"parag"}'
```

Response shape: `{"ok": true, "result": { "data": [...] }}` or `{"ok": false, "error": {"code","message","retryable"}}`. Always inspect `ok` before reading `result`.

## Rules

- **Search before create** — never create a duplicate contact/company/deal.
- **Don't over-promise enrichment** — say "the enrichment agent will fill the dossier in a few minutes," not "here's the full profile" until you've actually read `customFields.dossier`.
- **Stick to data, not opinion** — if the user asks about a contact's job change, look at `customFields.dossier.journey[]`, don't speculate.
- **One action, then confirm** — for risky moves (closing a deal, deleting a contact), do the read but ask the user before the write.
- **Money is in cents** — always. `5000000` = $50,000.
