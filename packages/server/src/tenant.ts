import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DEFAULT_PIPELINE_STAGES } from "@boringos-crm/shared";
import { pipelines, pipelineStages } from "./schema/pipelines.js";

/**
 * Create a new tenant with a default sales pipeline.
 * Returns the tenant ID.
 */
export async function createTenantWithPipeline(db: PostgresJsDatabase, tenantName: string): Promise<string> {
  const tenantId = randomUUID();
  const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  await db.execute(sql`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES (${tenantId}, ${tenantName}, ${slug + "-" + tenantId.slice(0, 8)}, now(), now())
  `);

  const pipelineId = randomUUID();
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

  return tenantId;
}

/**
 * Link a user to a tenant with a given role.
 */
export async function linkUserToTenant(db: PostgresJsDatabase, userId: string, tenantId: string, role: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO user_tenants (id, user_id, tenant_id, role)
    VALUES (${randomUUID()}, ${userId}, ${tenantId}, ${role})
  `);
}

/**
 * Get all tenants a user belongs to.
 */
export async function getUserTenants(db: PostgresJsDatabase, userId: string): Promise<Array<{ tenantId: string; tenantName: string; role: string }>> {
  const result = await db.execute(sql`
    SELECT ut.tenant_id as "tenantId", t.name as "tenantName", ut.role
    FROM user_tenants ut
    JOIN tenants t ON t.id = ut.tenant_id
    WHERE ut.user_id = ${userId}
    ORDER BY t.name
  `);
  return result as unknown as Array<{ tenantId: string; tenantName: string; role: string }>;
}

/**
 * Get all users in a tenant.
 */
export async function getTenantUsers(db: PostgresJsDatabase, tenantId: string): Promise<Array<{ userId: string; name: string; email: string; role: string; joinedAt: string }>> {
  const result = await db.execute(sql`
    SELECT u.id as "userId", u.name, u.email, ut.role, ut.created_at as "joinedAt"
    FROM user_tenants ut
    JOIN auth_users u ON u.id = ut.user_id
    WHERE ut.tenant_id = ${tenantId}
    ORDER BY ut.created_at
  `);
  return result as unknown as Array<{ userId: string; name: string; email: string; role: string; joinedAt: string }>;
}

/**
 * Update a user's role in a tenant.
 */
export async function updateUserRole(db: PostgresJsDatabase, userId: string, tenantId: string, role: string): Promise<void> {
  await db.execute(sql`
    UPDATE user_tenants SET role = ${role}
    WHERE user_id = ${userId} AND tenant_id = ${tenantId}
  `);
}

/**
 * Remove a user from a tenant.
 */
export async function removeUserFromTenant(db: PostgresJsDatabase, userId: string, tenantId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM user_tenants WHERE user_id = ${userId} AND tenant_id = ${tenantId}
  `);
}
