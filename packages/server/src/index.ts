import { BoringOS } from "@boringos/core";
import { createCrmRoutes } from "./routes/index.js";
import { createCrmContext } from "./context.js";
import { provisionCrmTenant } from "./tenant.js";

const app = new BoringOS({});

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

// When a new tenant signs up, create the default sales pipeline
app.onTenantCreated(async (db, tenantId) => {
  await provisionCrmTenant(db as any, tenantId);
});

// CRM data routes — framework auth middleware resolves session inside
app.beforeStart(async (ctx) => {
  const crmCtx = createCrmContext(ctx.db);
  app.route("/api/crm", createCrmRoutes(crmCtx));
});

const server = await app.listen(3001);

console.log("BoringOS CRM server running on http://localhost:3001");
