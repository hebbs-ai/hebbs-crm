# MDK T8.1 — CRM framework-table bypass audit

**Date:** 2026-05-29
**Status:** Audit complete; remediation tracked under T8.3 / T8.5.

The MDK plan flags T8.1 as: _"Audit CRM for any other framework-table
bypasses besides what's already on the executeAction shim. Replace
direct drizzle hits with module-sdk primitives (events/tools)."_

Below is every framework-owned table the CRM server still touches
with raw SQL, plus the disposition (T8.3 covers seed migration to
`Lifecycle.seed`; T8.5 the E2E gate).

## Findings

### `agents` / `workflows` / `routines` — declarative seeds

All in `packages/server/src/lifecycle.ts`. Writes:

- `INSERT INTO agents (...)` — 7 CRM agents (`email-lens`,
  `enrichment-contact`, `enrichment-company`, `deal-analyst`,
  `follow-up-writer`, `meeting-prep`, `crm-maintenance`).
- `INSERT INTO workflows (...)` — 4 declared workflows plus 5 system
  workflows.
- `INSERT INTO routines (...)` — 4 cron routines.

**Disposition: T8.3.** Move into `Lifecycle.seed(ctx, ...)` with
`__seed_meta`-backed upgrade safety (MDK T7.1 + T7.2). The declarative
manifest path covers the workflows + routines; agents stay on the
imperative path because they need the per-tenant Claude runtime id +
`reportsTo` chain.

### `scrubCrmSeeds` — pre-seed cleanup

`packages/server/src/lifecycle.ts:213-280`. Per-tenant clean-up that
runs at the top of `onInstall`:

- `DELETE FROM agent_runs WHERE agent_id IN (CRM agents)`
- `DELETE FROM agent_wakeup_requests WHERE agent_id IN (CRM agents)`
- `DELETE FROM cost_events WHERE agent_id IN (CRM agents)`
- `DELETE FROM workflow_runs WHERE workflow_id IN (CRM workflows)`
- `DELETE FROM workflows WHERE tenant_id = ... AND name IN (CRM names)`
- `DELETE FROM routines WHERE tenant_id = ... AND title IN (CRM titles)`
- `UPDATE tasks SET assignee_agent_id = NULL WHERE ... IN (CRM agents)`
- `UPDATE tasks SET created_by_agent_id = NULL WHERE ... IN (CRM agents)`
- `DELETE FROM agents WHERE tenant_id = ... AND role IN (CRM roles)`

**Disposition: T8.3.** The framework's MDK T7.2 (`__seed_meta`-based
upgrade policy) makes most of `scrubCrmSeeds` redundant — on re-install
the framework re-uses existing seed rows where possible. Where CRM
actually needs to drop (e.g. retired agents from earlier versions),
the cleanup should live in a tracked, idempotent codemod or in the
existing `onUninstall` hook. Keep the cascade of `agent_runs` /
`cost_events` clean-ups as a framework concern (Lifecycle.unseed is
worth a follow-up after T8.3 lands).

### `INSERT INTO connectors` — legacy v1 table, dead code

`packages/server/src/lifecycle.ts:337-345` (inside `seedSlack`).
Guarded by `SLACK_BOT_TOKEN` env var. Writes to the legacy v1
`connectors` table (one row per tenant per provider) which was
superseded by `connector_accounts` (multi-account, AuthManager-owned)
in MDK T0.

**Disposition: REMOVE.** Tracked as part of T8.3 cleanup. Either:

1. Drop `seedSlack` entirely — Slack OAuth flows through the same
   `/api/connectors/oauth/slack/authorize` path Google uses, no
   tenant-level bot token shortcut needed; OR
2. Rewrite to populate `connector_accounts` + the AuthManager
   binding row if the env-gated shortcut is still useful for self-host
   demos.

T8.3 will pick one when it touches the seeder; for now this is
inert because no env-gated install path currently runs in production.

### Read-only framework tables

CRM reads from `agents`, `workflows`, `routines`, `tenants`,
`runtimes` in lifecycle precondition checks (e.g.
`fetchClaudeRuntimeId`, `fetchRootAgentId`). These are correct uses —
the framework deliberately exposes those via raw SQL until module-sdk
ships typed accessors. No remediation; revisit when module-sdk grows
`ctx.agents.list()` / `ctx.runtimes.findByType()` helpers.

## Out-of-scope tables (CRM-owned)

The audit covered framework tables only. CRM's own `crm__*` tables
are fully owned by the module's own migrations and are not a "bypass".

## Summary

| Bypass                  | Disposition | Tracked under |
|---|---|---|
| agents / workflows / routines INSERTs | Move to `Lifecycle.seed` | T8.3 |
| scrubCrmSeeds cascade   | Become mostly redundant with `__seed_meta`; trim | T8.3 |
| `INSERT INTO connectors` | Dead — remove or rewrite for v2 | T8.3 |
| Read-only fetches       | Correct usage; revisit when SDK grows helpers | — |

Net: **no surprise framework-table writes beyond the seeder.** The
`executeAction` Gmail/Calendar shim noted in T0.3 is a separate
boundary (CRM ↔ connector-google) and not a framework-table
bypass.

T8.2 next: generate `module.json` from the manifest so we drop the
hand-written copy.
