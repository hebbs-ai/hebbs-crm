---
id: crm.meeting-prep
priority: 50
roles: [meeting-prep]
requires:
  - crm.contacts.list
  - crm.deals.list
  - crm.activities.list
  - crm.activities.create
  - framework.tasks.read
  - framework.tasks.patch
  - framework.comments.post
  - slack.send_message
---
## When You Wake

The framework wakes you on a meeting task — the task id and tenant are already in your context. Each task description contains: meeting title, event ID, start time, attendees, location, description.

If you need to re-read the task body or its comments at any point, use `framework.tasks.read`:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/framework.tasks.read" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "TASK_ID"}'
```

The framework auto-rewakes you while you still have pending todos — process the current task end-to-end, then end the run; the next meeting task will arrive on the next wake.

### Step 1: Identify participants

Extract attendee emails from the task description. Search CRM contacts:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.contacts.list" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"search": "ATTENDEE_EMAIL"}'
```

### Step 2: Find linked deals

For matched contacts, find their deals:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.deals.list" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Match by contactId or companyId.

### Step 3: Get context

Get recent activities for the contact:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.activities.list" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contactId": "CONTACT_ID"}'
```

Check contact enrichment (`customFields.enrichment`) and deal intelligence (`customFields.agentIntelligence`) for extra context.

### Step 4: Generate prep notes

Write comprehensive but scannable prep notes as a comment on the task:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/framework.comments.post" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "TASK_ID",
    "body": "## Meeting Prep: [Title]\n**Time:** [time] | **With:** [names]\n\n### Key Context\n- [deal status]\n- [last interaction]\n\n### Talking Points\n1. [point]\n2. [point]\n\n### Watch Out For\n- [risks]"
  }'
```

### Step 5: Log meeting as CRM activity

Create an activity so the meeting appears on contact/deal timelines:

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/crm.activities.create" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "OWNER_USER_ID",
    "type": "meeting",
    "subject": "Upcoming: [Meeting Title]",
    "body": "Meeting with [attendees] at [time]. Prep notes generated.",
    "contactId": "CONTACT_ID_OR_NULL",
    "dealId": "DEAL_ID_OR_NULL"
  }'
```

### Step 6: Send to Slack (if connected)

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/slack.send_message" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "general",
    "text": "Meeting in 1 hour: [Title] with [names]\n\n[condensed key points]"
  }'
```

If Slack returns `{"ok": false, ...}` (e.g. not connected), skip silently.

### Step 7: Mark task as done

```
curl -X POST "$BORINGOS_CALLBACK_URL/api/tools/framework.tasks.patch" \
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "TASK_ID", "status": "done"}'
```

## Important Rules

- **Process every pending task you're woken on** — the framework auto-rewakes while there are todos; complete the current task fully each run
- **The system already deduped** — if you have a task, it's a new meeting that hasn't been prepped
- **Be concise** — the rep reads this 5 minutes before the call, not 5 paragraphs
- **Use CRM data** — don't make up facts. If no contact/deal found, say so
- **Always log the activity** — even if you can't find CRM context, log the meeting
- **Always mark task done** — so the system knows this meeting was prepped

## Memory Usage

**Before prepping:** Prime ALL memories for the contact and deal.
```bash
hebbs prime contact-UUID --max-memories 20 --format json
hebbs prime deal-UUID --max-memories 15 --format json
```

**Also recall org knowledge:** Product info, pricing, case studies relevant to this meeting.
```bash
hebbs recall "case studies for INDUSTRY" --entity-id org --weights 0.7:0.1:0.1:0.1 --top-k 5 --format json
hebbs recall "competitive positioning against COMPETITOR" --entity-id org --weights 0.7:0.1:0.1:0.1 --top-k 5 --format json
```

**After prepping:** Remember the meeting context for post-meeting follow-up.
```bash
hebbs remember "Prep for Stripe meeting Apr 16: key topics are pricing, CFO intro, security review. Competitor Adyen mentioned." --entity-id deal-UUID --importance 0.6 --format json
```
