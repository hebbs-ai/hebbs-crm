# BoringOS CRM

CRM application for the BoringOS framework. **Shell-hosted** — installed
into a running BoringOS host via the framework's install pipeline rather
than booted as a standalone HTTP server.

## What lives here

- `boringos.json` — app manifest (id, capabilities, entity types, UI surface).
- `packages/server` — library exports the framework consumes:
  - `createCrmApp(ctx)` factory returning the typed `AppDefinition`.
  - `crmAppStatic`, `crmAgents`, `crmWorkflows` for tests + manifest validation.
  - CRM routes, agents, schema, tenant provisioning. No standalone HTTP entry.
- `packages/web` — the CRM's React UI surface, exported as a `UIDefinition`
  via `src/ui.ts`. The shell mounts these slot components inside its own
  Layout chrome at install time.
- `packages/shared` — DTOs and constants shared between server and web.

## Building

```bash
pnpm install
pnpm typecheck
pnpm build
```

## Running

The CRM no longer ships a `pnpm dev` entry. Install it into a BoringOS
host (via `POST /api/admin/apps/install` with this directory as the
manifest source) and access it through the host's shell.
