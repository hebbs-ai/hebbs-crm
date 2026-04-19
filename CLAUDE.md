# BoringOS CRM — Development Guide

> This is a **BoringOS application**, not a standalone product. It uses the BoringOS framework for everything the framework provides and only builds what's CRM-specific. It is the living reference implementation of how to build on BoringOS.

## Core Principle

**Use the framework. Don't rebuild it.**

BoringOS provides: auth, tasks, agents, runtimes, workflows, connectors, inbox, memory, search, realtime events, activity logging, entity references, admin API, copilot. The CRM uses all of these. It only builds CRM-specific things: contacts, companies, deals, pipelines, activities.

When in doubt: check if BoringOS already has it. If it does, use it. If it almost does, extend it. Only build from scratch if the framework has nothing for that domain.

## What the Framework Provides (USE THESE)

| Capability | Framework Route/Feature | CRM Should Use |
|---|---|---|
| **Auth** | `/api/auth/*` (signup, login, logout, /me) | Frontend calls framework auth directly |
| **Admin API** | `/api/admin/*` (agents, tasks, runs, runtimes, workflows, budgets, inbox, search) | Frontend + copilot use admin API for all framework entities |
| **Tasks** | `tasks` table, assigneeUserId/agentId, comments, work products | CRM tasks = framework tasks. Link to deals/contacts via entity refs |
| **Agents** | Agent engine, personas, wake/queue/execute pipeline | CRM agents are framework agents with CRM context providers |
| **Copilot** | `/api/copilot/*` (sessions, messages), auto-wake on comment | Cmd+K wires to copilot sessions API |
| **Inbox** | `inbox_items` table, `routeToInbox()`, assigneeUserId | Email/lead routing uses framework inbox |
| **Workflows** | DAG engine, 9 block handlers, routines | Email sync, lead routing, Slack notifications = framework workflows |
| **Connectors** | Gmail, Calendar, Slack + connector SDK | Register in CRM app via `app.connector()` |
| **Memory** | `MemoryProvider` interface, Hebbs + null providers | `app.memory()` — agents get memory automatically |
| **Entity refs** | `entity_references` table | Link deals→tasks, contacts→inbox items, etc. |
| **Realtime** | SSE events, realtime bus | Live updates for multi-user CRM |
| **Activity log** | `activity_log` table in admin routes | Framework logs agent/task events automatically |
| **Search** | `GET /api/admin/search?q=` across entities | Cross-entity search |
| **Budgets** | Budget policies, cost tracking per agent | Agent cost management |

## What the CRM Builds (DOMAIN-SPECIFIC ONLY)

| CRM Feature | Why It's CRM-Specific |
|---|---|
| Contacts, Companies, Deals schemas + CRUD | Domain entities the framework doesn't have |
| Pipelines & stages | CRM-specific sales workflow |
| CRM activity timeline | Domain-specific timeline (calls, emails, meetings on contacts/deals) |
| Deal forecast | CRM-specific calculation |
| Team invitations | CRM-specific invite flow (extends framework's user_tenants) |
| CRM context providers | Teach agents about CRM data |
| Agent instructions/personas | CRM-specific agent behaviors |

## Teaching Agents About CRM Endpoints

Agents learn the CRM API via the framework's built-in `api-catalog` context provider. When the CRM mounts routes with `app.route("/api/crm", routes, { agentDocs })`, the framework injects those docs into every agent run's system prompt — **no app-level context provider needed**.

**Single source of truth:** each file in `packages/server/src/routes/` exports both its Hono router and an `agentDocs(url: string): string` function that documents the endpoints agents should use. `context-providers/crm-schema.ts` aggregates them into `crmAgentDocs(url)`, which is passed to `app.route()` in `index.ts`.

**Rules:**
- When you add a new route group, add an `agentDocs` export to the route file and import it in `crm-schema.ts`.
- When you change an endpoint (new param, different body shape, new verb), update `agentDocs` in the same file in the same commit. Stale prompt docs = agents that try to call endpoints that no longer exist.
- If a route is operator/UI-only and agents shouldn't call it, omit it from `agentDocs` — the function documents the *agent-facing* subset, not every route.

## Architecture

```
Frontend (React)
  ├── /api/auth/*           → BoringOS auth (signup, login, /me, invitations, team)
  ├── /api/admin/*          → BoringOS admin API (tasks, agents, inbox, search) [Phase 2]
  ├── /api/copilot/*        → BoringOS copilot (sessions, messages) [Phase 2]
  └── /api/crm/*            → CRM routes (contacts, deals, companies, pipelines, activities)

Server (BoringOS app)
  ├── app.schema()            → CRM tables DDL
  ├── app.onTenantCreated()   → Pipeline setup (framework handles runtimes + copilot)
  ├── app.contextProvider()   → CRM context for agents [Phase 2]
  ├── app.connector()         → Gmail, Calendar, Slack [Phase 3]
  ├── app.memory()            → Hebbs [Phase 5]
  ├── app.route("/api/crm")   → CRM-specific routes only
  └── createAuthMiddleware()  → Framework middleware on CRM routes
```

**CRM has zero auth code.** Framework handles everything: multi-tenant signup, invitations, team management, tenant switching. CRM only provides `onTenantCreated` hook for pipeline setup.

## Current Gaps (to fix)

### Framework features fully used

- **Auth** — Framework handles all auth: multi-tenant signup (creates tenant + runtimes + copilot), invitations, team management, tenant switching, `/me` with tenant list. CRM has zero auth code.
- **Auth middleware** — CRM routes use `createAuthMiddleware(db)` from framework. Zero custom session resolution.
- **Copilot** — Framework's `/api/copilot/*` is multi-tenant, session-authenticated. Works for all dynamically created tenants.
- **Tenant provisioning** — Framework auto-seeds 6 runtimes + copilot per tenant. CRM only uses `onTenantCreated` hook for pipeline setup.

### CRM-specific (correctly not in framework)

- **Activity logging (`activity-logger.ts`)** — Framework's `activity_log` tracks admin mutations (agent.created, task.updated). CRM's `crm_activities` tracks domain events (deal stage changed, contact created, call logged). Different purpose, different schema, different consumers.

### Remaining gaps — framework features not yet used

1. **Tasks not used** — Framework tasks (with assignees, comments, work products) aren't exposed in the CRM. Phase 2 fixes this.

2. **Inbox not used** — Framework inbox exists but CRM doesn't use it yet. Phase 3 will use it.

3. **Entity references not used** — No linking CRM entities to framework entities. Should be added when tasks are introduced.

4. **Realtime not used** — No live updates when another user modifies a deal.

## Tenant Provisioning

Every new tenant (created on signup) gets:
1. Tenant record
2. Default sales pipeline + 7 stages
3. 6 runtimes (claude, chatgpt, gemini, ollama, command, webhook)
4. Copilot agent

Without runtimes + copilot, no agentic features work. This is the #1 prerequisite for building on BoringOS.

## Development

```bash
# Server (port 3001)
cd packages/server && pnpm dev

# Web (port 5173, proxies /api → 3001)
cd packages/web && pnpm dev

# Build
pnpm -r build
```

### Environment variables

| Var | Default | Effect |
|---|---|---|
| `AGENT_QUEUE_CONCURRENCY` | `4` | Max agent runs executed in parallel by the in-process queue. Each slot spawns its own agent subprocess — raise with care (RAM, Anthropic rate limits, Postgres pool). Ops-level knob, not user-facing. |

## Deployed

- Frontend: https://crm.boringos.dev
- API: https://crmapi.boringos.dev
