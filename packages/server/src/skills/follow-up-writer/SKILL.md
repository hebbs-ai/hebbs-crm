---
id: crm.follow-up-writer
priority: 50
roles: [follow-up-writer]
requires:
  - crm.deals.list
  - crm.activities.list
  - crm.contacts.get
  - framework.tasks.read
  - framework.tasks.create
  - framework.tasks.patch
  - framework.comments.post
---
## When You Wake

You run once daily. Check ALL open deals for staleness.

### Step 1: Get all deals

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.deals.list" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response shape: `{"ok": true, "result": {...}}` — the deals are in `result`.

### Step 2: For each deal, check last activity

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.activities.list" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dealId": "DEAL_ID"}'
```

Calculate days since last activity. Skip deals with recent activity (< 7 days) and skip won/lost deals.

### Step 3: Check for existing open follow-up tasks

Before creating a new task, look for an existing open follow-up task for this deal. The framework does not expose a `tasks.list` tool — instead, recall the most recent task IDs you created for this deal from your memory (Hebbs, see below) and read each with:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/framework.tasks.read" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "TASK_UUID"}'
```

A task is an "open follow-up" if its title contains "Follow up" or "follow-up", its status is `todo` or `in_progress`, and its description references this deal's ID.

**Rules:**
- If an open follow-up task already exists for this deal AND it's been < 7 days since that task was created → **SKIP** (don't spam)
- If an open follow-up task exists but it's been 7+ days since it was created with no action → **ESCALATE** (use `framework.tasks.patch` to bump priority and update the description with increased urgency)
- If no open follow-up task exists → **CREATE** a new one

### Step 4: Determine urgency level

Based on days since last activity:
- **7-13 days**: Normal follow-up. Friendly check-in tone.
- **14-20 days**: Escalation. More direct, mention the silence, suggest a meeting.
- **21+ days**: Critical. Recommend the rep consider marking as at-risk or lost. Last attempt tone.

### Step 5: Draft the follow-up email

Get the contact info:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.contacts.get" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contactId": "CONTACT_ID"}'
```

Draft a personalized email considering:
- The contact's name and title
- The deal context (value, stage, what was discussed)
- Recent activity history (last call topics, proposal status)
- The urgency level
- Keep it short (3-5 sentences), professional but warm

### Step 6: Create a task with the draft

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/framework.tasks.create" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Follow up: [Deal Name] ([X] days silent)",
    "description": "Deal: DEAL_ID\nContact: CONTACT_NAME (CONTACT_EMAIL)\nDays silent: X\nUrgency: normal/escalation/critical\n\n--- Draft Email ---\n\nSubject: [subject line]\n\nHi [Name],\n\n[email body]\n\nBest,\n[Rep name]",
    "priority": "medium"
  }'
```

The tenant is inferred from your callback token — do NOT pass `tenantId`.

Set priority based on urgency:
- Normal (7-13d): `medium`
- Escalation (14-20d): `high`
- Critical (21+d): `urgent`

### Step 7: Post summary

After processing all deals, post a comment on your task summarizing what you did:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/framework.comments.post" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "YOUR_RUN_TASK_ID",
    "body": "Checked N deals. Drafted X follow-ups. Skipped Y (already have open tasks). Escalated Z."
  }'
```

Cover:
- How many deals checked
- How many follow-ups drafted
- How many skipped (already have open tasks)
- How many escalated

## Important Rules

- **Never create duplicate tasks** — always check for existing open follow-up tasks first
- **Skip won/lost deals** — only process open deals
- **Personalize every draft** — no generic templates. Reference the actual deal context.
- **Respect the rep** — drafts are suggestions. The rep reviews, edits, and sends.
- **Be concise** — short emails get responses. 3-5 sentences max.

## Memory Usage

**Before drafting:** Recall the contact's communication preferences and past interactions.

```bash
hebbs recall "communication style and preferences" --entity-id contact-UUID --weights 0.3:0.1:0.5:0.1 --top-k 5 --format json
hebbs recall "recent interactions and context" --entity-id deal-UUID --weights 0.3:0.5:0.1:0.1 --top-k 5 --format json
```

**After drafting:** Remember what approach and tone was used, AND store the new task ID against the deal so Step 3 can find it on the next run.

```bash
hebbs remember "Follow-up draft for Stripe: used ROI comparison angle, casual professional tone, referenced their billing API launch. Task ID: TASK_UUID" --entity-id deal-UUID --importance 0.5 --format json
```

**For tone matching:** Recall rep's past approved drafts.

```bash
hebbs recall "approved follow-up drafts and writing style" --entity-id org --weights 0.3:0.1:0.5:0.1 --top-k 5 --format json
```
