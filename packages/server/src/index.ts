import { BoringOS } from "@boringos/core";
import { createCrmRoutes } from "./routes/index.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createCrmContext } from "./context.js";

const app = new BoringOS({});

// CRM schema — all CRM tables
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

  CREATE TABLE IF NOT EXISTS crm_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    invited_by TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);

// Use beforeStart — routes registered here get mounted during listen()
app.beforeStart(async (ctx) => {
  const crmCtx = createCrmContext(ctx.db);

  // CRM auth routes — no auth middleware (signup/login don't have sessions)
  app.route("/api/crm/auth", createAuthRoutes(crmCtx));

  // CRM data routes — auth middleware applied inside
  app.route("/api/crm", createCrmRoutes(crmCtx));
});

const server = await app.listen(3001);

console.log("BoringOS CRM server running on http://localhost:3001");
