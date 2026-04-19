import { BoringOS } from "@boringos/core";
import { google } from "@boringos/connector-google";
import { slack } from "@boringos/connector-slack";
import { createCrmRoutes } from "./routes/index.js";
import { createCrmContext } from "./context.js";
import { provisionCrmTenant } from "./tenant.js";
import { crmAgentDocs } from "./context-providers/crm-schema.js";
import { createCrmUserContextProvider } from "./context-providers/crm-user-context.js";
import { createCrmMemoryProvider } from "./context-providers/crm-memory.js";
import { createCompanyProfileProvider } from "./context-providers/crm-company-profile.js";
import { crmCopilotDisciplineProvider } from "./context-providers/crm-copilot-discipline.js";

const app = new BoringOS({
  // Default to 4 parallel agent runs; tune via AGENT_QUEUE_CONCURRENCY env
  // var. Each slot spawns its own agent subprocess, so raise with care
  // (RAM, Anthropic rate limits, Postgres pool).
  queue: {
    concurrency: Number(process.env.AGENT_QUEUE_CONCURRENCY ?? 4),
  },
});

// Register connectors
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  app.connector(google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }));
}
if (process.env.SLACK_SIGNING_SECRET) {
  app.connector(slack({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  }));
}

// CRM-specific schema
app.schema(`
  CREATE TABLE IF NOT EXISTS crm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    company_id UUID,
    title TEXT,
    linkedin TEXT,
    source TEXT,
    tags JSONB DEFAULT '[]',
    custom_fields JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_contacts_tenant_idx ON crm_contacts(tenant_id);
  CREATE INDEX IF NOT EXISTS crm_contacts_owner_idx ON crm_contacts(tenant_id, owner_id);

  CREATE TABLE IF NOT EXISTS crm_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    name TEXT NOT NULL,
    domain TEXT,
    industry TEXT,
    size TEXT,
    website TEXT,
    address TEXT,
    custom_fields JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_companies_tenant_idx ON crm_companies(tenant_id);

  CREATE TABLE IF NOT EXISTS crm_pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_pipelines_tenant_idx ON crm_pipelines(tenant_id);

  CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    probability REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_pipeline_stages_pipeline_idx ON crm_pipeline_stages(pipeline_id);

  CREATE TABLE IF NOT EXISTS crm_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    title TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    pipeline_id UUID NOT NULL,
    stage_id UUID NOT NULL,
    probability REAL,
    expected_close_date DATE,
    contact_id UUID,
    company_id UUID,
    lost_reason TEXT,
    custom_fields JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_deals_tenant_idx ON crm_deals(tenant_id);
  CREATE INDEX IF NOT EXISTS crm_deals_pipeline_idx ON crm_deals(tenant_id, pipeline_id);

  CREATE TABLE IF NOT EXISTS crm_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT,
    contact_id UUID,
    deal_id UUID,
    company_id UUID,
    user_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_activities_tenant_idx ON crm_activities(tenant_id);
  CREATE INDEX IF NOT EXISTS crm_activities_contact_idx ON crm_activities(tenant_id, contact_id);
  CREATE INDEX IF NOT EXISTS crm_activities_deal_idx ON crm_activities(tenant_id, deal_id);

  CREATE TABLE IF NOT EXISTS crm_knowledge_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    remote_path TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'org',
    entity_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_knowledge_files_tenant_idx ON crm_knowledge_files(tenant_id);
  ALTER TABLE crm_knowledge_files ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'org';
  ALTER TABLE crm_knowledge_files ADD COLUMN IF NOT EXISTS entity_id TEXT;
`);

// CRM context providers — teach copilot about CRM data
// Registered before listen() so they're in the context pipeline
let dbRef: unknown = null;
app.contextProvider(createCompanyProfileProvider(() => dbRef));
app.contextProvider(createCrmUserContextProvider(() => dbRef));
app.contextProvider(createCrmMemoryProvider(() => dbRef));
app.contextProvider(crmCopilotDisciplineProvider);

// When a new tenant signs up, create the default sales pipeline + agents
app.onTenantCreated(async (db, tenantId) => {
  await provisionCrmTenant(db as any, tenantId);
});

// All connector-event dispatching now lives in system workflows seeded by
// provisionCrmTenant — see tenant.ts step 10. The framework's event-dispatch
// primitive matches incoming eventBus events against active workflows whose
// trigger.config.eventType matches and fires every match in a microtask.
//
// Replaced (Phase 7b finish):
//   inbox.item_created      → "Triage new inbox items" workflow
//   connector.connected     → "Activate sync routines on Google connect" workflow
//   calendar.upcoming_events → "Prep upcoming meetings" workflow
//   entity.created          → "Enrich new contact" / "Enrich new company" / "Analyze new deal" workflows

// CRM data routes
app.beforeStart(async (ctx) => {
  dbRef = ctx.db;
  const crmCtx = createCrmContext(
    ctx.db,
    (type, tenantId, data) => {
      ctx.eventBus?.emit({
        connectorKind: "crm",
        type,
        tenantId,
        data,
        timestamp: new Date(),
      }).catch(() => {});
    },
    ctx.agentEngine as any,
    ctx.workflowEngine as any,
  );
  app.route("/api/crm", createCrmRoutes(crmCtx), { agentDocs: crmAgentDocs });
});

const server = await app.listen(3001);

console.log("BoringOS CRM server running on http://localhost:3001");
