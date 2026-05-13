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

  },
  async down(db) {
    // crm__knowledge_files was dropped in 003-drop-knowledge-files (U6) —
    // CASCADE here to clean up older installs whose 003 migration was
    // skipped because 001 already ran without it.
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

// U6 cleanup: drop the legacy crm__knowledge_files table on any tenant
// that previously ran the v0.1 / v0.2 init migration. New installs never
// create the table (it's been removed from `init` above), but existing
// tenants need this idempotent drop to clean up after the unwind.
const dropKnowledgeFiles: Migration = {
  id: "003-drop-knowledge-files",
  async up(db) {
    await db.execute(`DROP TABLE IF EXISTS crm__knowledge_files CASCADE;`);
  },
  async down() {
    // Intentionally a no-op — we never want this table back. If a
    // future module re-introduces entity-attached documents, it should
    // ship its own migration with a different name.
  },
};

// Contact email dedupe — `inbox.sync` auto-creates contacts from
// inbound senders. Without a uniqueness constraint, two near-simultaneous
// emails from the same address (or a manual create + an inbound) end up
// as two contact rows for the same person. Partial index so contacts
// without an email (manually-entered phone-only leads) stay free to
// repeat. lower(email) so case-only differences (parag@x vs PARAG@x)
// collide.
const dedupeContactEmail: Migration = {
  id: "004-contact-email-uniq",
  async up(db) {
    // First, dedupe any existing rows that would block the index. Keep
    // the earliest row by created_at and reassign any FK references on
    // the rest before deleting them. The activity / deal tables are
    // soft-linked (uuid columns, no FK), so a plain UPDATE is enough.
    await db.execute(`
      WITH winners AS (
        SELECT DISTINCT ON (tenant_id, lower(email)) id, tenant_id, lower(email) AS k
        FROM crm__contacts
        WHERE email IS NOT NULL
        ORDER BY tenant_id, lower(email), created_at ASC
      ),
      losers AS (
        SELECT c.id AS loser_id, w.id AS winner_id
        FROM crm__contacts c
        JOIN winners w
          ON w.tenant_id = c.tenant_id AND w.k = lower(c.email)
        WHERE c.email IS NOT NULL AND c.id <> w.id
      )
      UPDATE crm__deals d SET contact_id = l.winner_id
      FROM losers l WHERE d.contact_id = l.loser_id;
    `);
    await db.execute(`
      WITH winners AS (
        SELECT DISTINCT ON (tenant_id, lower(email)) id, tenant_id, lower(email) AS k
        FROM crm__contacts
        WHERE email IS NOT NULL
        ORDER BY tenant_id, lower(email), created_at ASC
      ),
      losers AS (
        SELECT c.id AS loser_id, w.id AS winner_id
        FROM crm__contacts c
        JOIN winners w
          ON w.tenant_id = c.tenant_id AND w.k = lower(c.email)
        WHERE c.email IS NOT NULL AND c.id <> w.id
      )
      UPDATE crm__activities a SET contact_id = l.winner_id
      FROM losers l WHERE a.contact_id = l.loser_id;
    `);
    await db.execute(`
      DELETE FROM crm__contacts c
      WHERE c.email IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM crm__contacts o
          WHERE o.tenant_id = c.tenant_id
            AND lower(o.email) = lower(c.email)
            AND o.created_at < c.created_at
        );
    `);
    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS crm__contacts_tenant_email_uniq
        ON crm__contacts(tenant_id, lower(email))
        WHERE email IS NOT NULL;
    `);
  },
  async down(db) {
    await db.execute(`DROP INDEX IF EXISTS crm__contacts_tenant_email_uniq;`);
  },
};

// Exactly one default pipeline per tenant — lifecycle.seedPipeline()
// always inserts one default, but a UI / API call that flips
// `is_default = true` on a second pipeline without unsetting the first
// breaks downstream lookups (deals.create picks "the" default, several
// agents query for it). The partial index makes the DB the authority.
const uniqueDefaultPipeline: Migration = {
  id: "005-default-pipeline-uniq",
  async up(db) {
    // Coerce any pre-existing tenant that already has more than one
    // default down to one (oldest wins) so the index can be created.
    await db.execute(`
      WITH defaults AS (
        SELECT id, tenant_id,
               row_number() OVER (PARTITION BY tenant_id ORDER BY created_at ASC) AS rn
        FROM crm__pipelines
        WHERE is_default = true
      )
      UPDATE crm__pipelines p SET is_default = false
      FROM defaults d
      WHERE p.id = d.id AND d.rn > 1;
    `);
    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS crm__pipelines_tenant_default_uniq
        ON crm__pipelines(tenant_id)
        WHERE is_default = true;
    `);
  },
  async down(db) {
    await db.execute(`DROP INDEX IF EXISTS crm__pipelines_tenant_default_uniq;`);
  },
};

export const crmMigrations: Migration[] = [
  init,
  dedupeCompanyDomain,
  dropKnowledgeFiles,
  dedupeContactEmail,
  uniqueDefaultPipeline,
];
