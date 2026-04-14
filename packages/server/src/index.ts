import { BoringOS } from "@boringos/core";
import { google } from "@boringos/connector-google";
import { slack } from "@boringos/connector-slack";
import { createCrmRoutes } from "./routes/index.js";
import { createCrmContext } from "./context.js";
import { provisionCrmTenant } from "./tenant.js";
import { crmSchemaProvider } from "./context-providers/crm-schema.js";
import { createCrmUserContextProvider } from "./context-providers/crm-user-context.js";

const app = new BoringOS({});

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
`);

// CRM context providers — teach copilot about CRM data
// Registered before listen() so they're in the context pipeline
let dbRef: unknown = null;
app.contextProvider(crmSchemaProvider);
app.contextProvider(createCrmUserContextProvider(() => dbRef));

// When a new tenant signs up, create the default sales pipeline + agents
app.onTenantCreated(async (db, tenantId) => {
  await provisionCrmTenant(db as any, tenantId);
});

// Event-driven: wake Email Triage agent when new inbox items arrive
let agentEngineRef: any = null;
app.onEvent("inbox.item_created", async (event) => {
  if (!agentEngineRef) return;
  const db = dbRef as any;
  if (!db) return;

  // Find the email-triage agent for this tenant
  const { agents } = await import("@boringos/db");
  const { eq, and } = await import("drizzle-orm");
  const rows = await db.select().from(agents)
    .where(and(eq(agents.tenantId, event.tenantId), eq(agents.role, "email-triage")))
    .limit(1);
  const triageAgent = rows[0];
  if (!triageAgent) return;

  // Create a task for the agent with the inbox item ID
  const { tasks } = await import("@boringos/db");
  const { generateId } = await import("@boringos/shared");
  const taskId = generateId();
  await db.insert(tasks).values({
    id: taskId,
    tenantId: event.tenantId,
    title: `Triage inbox item`,
    description: `Analyze inbox item: ${event.data.itemId}\nSource: ${event.data.source}`,
    status: "todo",
    priority: "medium",
    assigneeAgentId: triageAgent.id,
    originKind: "agent-triage",
  });

  // Wake the agent
  const outcome = await agentEngineRef.wake({
    agentId: triageAgent.id,
    tenantId: event.tenantId,
    reason: "connector_event",
    taskId,
    payload: event.data,
  });
  if (outcome.kind === "created") {
    await agentEngineRef.enqueue(outcome.wakeupRequestId);
  }
});

// CRM data routes
app.beforeStart(async (ctx) => {
  dbRef = ctx.db;
  agentEngineRef = ctx.agentEngine;
  const crmCtx = createCrmContext(ctx.db);
  app.route("/api/crm", createCrmRoutes(crmCtx));
});

const server = await app.listen(3001);

console.log("BoringOS CRM server running on http://localhost:3001");
