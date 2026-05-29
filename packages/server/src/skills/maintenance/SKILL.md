---
id: crm.maintenance
priority: 60
roles: [crm-maintenance]
requires:
  - framework.tasks.read
  - framework.tasks.patch
  - framework.comments.post
  - crm.leads.scan_noise
  - crm.leads.delete_noise
---
## Procedure

When you wake on such a task, read it with `framework.tasks.read`.
Then check what comments exist:

- **No comments yet from you** → scan + propose:
  1. Call `crm.leads.scan_noise()` (read-only). The result has
     `candidates: [{ contactId, contactEmail, contactName, companyId,
     dealId, reasons }]`, `orphanCompanies: [{ id, name }]`, and
     `totals`.
  2. If `totals.contacts === 0` and `orphanCompanies.length === 0`,
     post a comment:
     ```
     Nothing flagged. Inbox cleanup is up to date.
     ```
     and patch the task to `status: "done"`. End the run.
  3. Otherwise, post ONE comment that groups candidates by their
     reason. Aim for a scannable Markdown table:
     ```markdown
     Found {totals.contacts} contact(s) that look like noise:

     | Name | Email | Reasons |
     | ---- | ----- | ------- |
     | ...  | ...   | ...     |

     Also {orphanCompanies.length} orphan company/companies will be
     removed once their contacts are deleted.

     Reply **yes** to delete everything listed,
     **no** to cancel, or
     **yes but skip <pattern>** (eg. `yes but skip substack.com`) to
     delete a filtered subset.
     ```
  4. Patch the task to `status: "human_todo"` and end the run.
     (The framework re-wakes you on the next user comment.)

- **Your last comment was the candidate list AND there's a newer
  user comment** → parse + act:
  1. Read the user's most recent comment.
  2. Classify their intent:
     - `yes` / `approve` / `go ahead` / `confirm` / `do it` →
       **confirmed**, delete every candidate.
     - `no` / `cancel` / `nevermind` / `stop` →
       **declined**, cancel the task.
     - `yes but skip X` / `delete only the Ys` / `everything except
       Z` → **partial**, delete a filtered subset.
     - Anything else → **ambiguous**, ask again.

  3. **confirmed**: re-run `crm.leads.scan_noise` (the world may
     have changed since the candidate list was posted), then call
     `crm.leads.delete_noise({ contactIds, companyIds, dealIds })`
     with every id from the scan. Post a comment summarising what
     was deleted:
     ```
     Done. Deleted {n} contact(s), {m} company/companies, {k} deal(s).
     ```
     Patch task to `status: "done"`. End the run.

  4. **declined**: post a one-line comment like `Cancelled — nothing
     deleted.` and patch the task to `status: "cancelled"`. End the
     run.

  5. **partial**: re-scan, then filter the candidate ids by the
     pattern the user gave (case-insensitive substring match against
     the contact email or display name). Call `crm.leads.delete_noise`
     with the filtered ids. Post a comment summarising what was
     deleted AND what was kept, then patch to `status: "done"`.

  6. **ambiguous**: post:
     ```
     Didn't catch that. Reply `yes`, `no`, or `yes but skip <pattern>`.
     ```
     Leave the task at `status: "human_todo"` and end the run.

## Cautions

- ALWAYS re-scan before calling `delete_noise`. Don't operate on a
  stale candidate list — the scan is cheap and the alternative is
  deleting a contact that just had a real reply.
- NEVER call `delete_noise` without a fresh user "yes" since your
  last candidate-list comment. If the loop has multiple comments,
  only the most-recent user comment counts.
- Deletion cascades to activities and deals. The `delete_noise`
  tool writes a `note` activity for each deletion BEFORE removing
  rows, so the timeline preserves the audit trail.
- Stay in your lane: don't reorder pipelines, don't touch the
  business profile, don't reply to inbound emails. Only inbox
  cleanup.

## When stuck

If the framework returns an error you can't recover from, or the
task has no comments after your candidate list for >7 days, post a
final comment explaining what happened and patch to
`status: "blocked"` with `assigneeAgentId: null` and
`assigneeUserId` set to the task's `createdByUserId`. Then end the
run.
