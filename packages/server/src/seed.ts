import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomUUID, createHmac } from "node:crypto";
import { DEFAULT_PIPELINE_STAGES } from "@boringos-crm/shared";
import { pipelines, pipelineStages } from "./schema/pipelines.js";

interface SeedConfig {
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  tenantName: string;
  authSecret: string;
}

/**
 * Seed the CRM with a tenant, admin user, and default pipeline.
 * Idempotent — skips if tenant already exists.
 */
export async function seedCrm(db: PostgresJsDatabase, config: SeedConfig) {
  // Check if any tenant exists
  const existing = await db.execute(sql`SELECT id FROM tenants LIMIT 1`);
  const existingRows = existing as unknown as Array<{ id: string }>;
  if (existingRows.length > 0) {
    console.log("[seed] Tenant already exists, skipping seed.");
    return;
  }

  console.log("[seed] No tenant found — seeding CRM...");

  const tenantId = randomUUID();
  const userId = randomUUID();
  const pipelineId = randomUUID();

  // 1. Create tenant
  await db.execute(sql`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES (${tenantId}, ${config.tenantName}, ${config.tenantName.toLowerCase().replace(/\s+/g, "-")}, now(), now())
  `);
  console.log(`[seed] Created tenant: ${config.tenantName} (${tenantId})`);

  // 2. Create admin user
  const passwordHash = createHmac("sha256", config.authSecret)
    .update(config.adminPassword)
    .digest("hex");

  await db.execute(sql`
    INSERT INTO auth_users (id, name, email, email_verified)
    VALUES (${userId}, ${config.adminName}, ${config.adminEmail}, false)
  `);

  await db.execute(sql`
    INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password)
    VALUES (${randomUUID()}, ${userId}, ${userId}, 'credential', ${passwordHash})
  `);

  await db.execute(sql`
    INSERT INTO user_tenants (id, user_id, tenant_id, role)
    VALUES (${randomUUID()}, ${userId}, ${tenantId}, 'admin')
  `);
  console.log(`[seed] Created admin user: ${config.adminEmail}`);

  // 3. Create default pipeline
  await db.insert(pipelines).values({
    id: pipelineId,
    tenantId,
    name: "Sales Pipeline",
    isDefault: true,
  });

  for (const stage of DEFAULT_PIPELINE_STAGES) {
    await db.insert(pipelineStages).values({
      id: randomUUID(),
      pipelineId,
      name: stage.name,
      sortOrder: stage.sortOrder,
      probability: stage.probability,
      type: stage.type,
    });
  }
  console.log(`[seed] Created default pipeline with ${DEFAULT_PIPELINE_STAGES.length} stages`);

  console.log("[seed] Done! You can now log in with:");
  console.log(`  Email: ${config.adminEmail}`);
  console.log(`  Password: ${config.adminPassword}`);
}
