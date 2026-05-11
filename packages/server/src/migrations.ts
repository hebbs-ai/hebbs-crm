// Migration[] for the v2 install pipeline. Each migration's `up()`
// runs CREATE TABLE + indexes; `down()` drops them. Idempotent at
// the install-manager level via the `module_migrations` tracking
// table.
//
// Keep these in lockstep with packages/server/src/schema/*.ts —
// the Drizzle pgTable definitions are the typed query layer, this
// file is the DDL the framework actually executes.

import type { Migration } from "@boringos/module-sdk";

const init: Migration = {
  id: "001-init",
  async up(db) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS crm__contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        owner_id uuid NOT NULL,
        first_name text NOT NULL,
        last_name text NOT NULL,
        email text,
        phone text,
        company_id uuid,
        title text,
        linkedin text,
        source text,
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__contacts_tenant_idx ON crm__contacts(tenant_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__contacts_owner_idx ON crm__contacts(tenant_id, owner_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__contacts_company_idx ON crm__contacts(tenant_id, company_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__contacts_email_idx ON crm__contacts(tenant_id, email);`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crm__companies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        owner_id uuid NOT NULL,
        name text NOT NULL,
        domain text,
        industry text,
        size text,
        website text,
        address text,
        custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__companies_tenant_idx ON crm__companies(tenant_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__companies_owner_idx ON crm__companies(tenant_id, owner_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__companies_domain_idx ON crm__companies(tenant_id, domain);`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crm__pipelines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name text NOT NULL,
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__pipelines_tenant_idx ON crm__pipelines(tenant_id);`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crm__pipeline_stages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pipeline_id uuid NOT NULL,
        name text NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        probability real NOT NULL DEFAULT 0,
        type text NOT NULL DEFAULT 'open',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__stages_pipeline_idx ON crm__pipeline_stages(pipeline_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__stages_sort_idx ON crm__pipeline_stages(pipeline_id, sort_order);`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crm__deals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        owner_id uuid NOT NULL,
        title text NOT NULL,
        value integer NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'USD',
        pipeline_id uuid NOT NULL,
        stage_id uuid NOT NULL,
        probability real,
        expected_close_date timestamptz,
        contact_id uuid,
        company_id uuid,
        lost_reason text,
        custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__deals_tenant_idx ON crm__deals(tenant_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__deals_owner_idx ON crm__deals(tenant_id, owner_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__deals_pipeline_idx ON crm__deals(tenant_id, pipeline_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__deals_stage_idx ON crm__deals(tenant_id, pipeline_id, stage_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__deals_contact_idx ON crm__deals(tenant_id, contact_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__deals_company_idx ON crm__deals(tenant_id, company_id);`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crm__activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        type text NOT NULL,
        subject text NOT NULL,
        body text,
        contact_id uuid,
        deal_id uuid,
        company_id uuid,
        user_id uuid NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__activities_tenant_idx ON crm__activities(tenant_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__activities_contact_idx ON crm__activities(tenant_id, contact_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__activities_deal_idx ON crm__activities(tenant_id, deal_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__activities_company_idx ON crm__activities(tenant_id, company_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__activities_user_idx ON crm__activities(tenant_id, user_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__activities_occurred_idx ON crm__activities(occurred_at);`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crm__knowledge_files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name text NOT NULL,
        size integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'pending',
        remote_path text NOT NULL,
        entity_type text,
        entity_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__knowledge_files_tenant_idx ON crm__knowledge_files(tenant_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS crm__knowledge_files_entity_idx ON crm__knowledge_files(tenant_id, entity_type, entity_id);`);
  },
  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS crm__knowledge_files CASCADE;`);
    await db.execute(`DROP TABLE IF EXISTS crm__activities CASCADE;`);
    await db.execute(`DROP TABLE IF EXISTS crm__deals CASCADE;`);
    await db.execute(`DROP TABLE IF EXISTS crm__pipeline_stages CASCADE;`);
    await db.execute(`DROP TABLE IF EXISTS crm__pipelines CASCADE;`);
    await db.execute(`DROP TABLE IF EXISTS crm__companies CASCADE;`);
    await db.execute(`DROP TABLE IF EXISTS crm__contacts CASCADE;`);
  },
};

// Domain dedupe — concurrent companies.create calls were producing
// duplicate rows for the same (tenant, domain). The tool-level
// SELECT-then-INSERT race-loses; this constraint makes the DB the
// authority. Partial index so NULL domains stay free to repeat.
const dedupeCompanyDomain: Migration = {
  id: "002-company-domain-uniq",
  async up(db) {
    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS crm__companies_tenant_domain_uniq
        ON crm__companies(tenant_id, domain)
        WHERE domain IS NOT NULL;
    `);
  },
  async down(db) {
    await db.execute(`DROP INDEX IF EXISTS crm__companies_tenant_domain_uniq;`);
  },
};

export const crmMigrations: Migration[] = [init, dedupeCompanyDomain];
