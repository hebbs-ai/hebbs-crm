import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DEFAULT_PIPELINE_STAGES } from "@boringos-crm/shared";
import { pipelines, pipelineStages } from "./schema/pipelines.js";

/**
 * CRM-specific tenant setup — called via app.onTenantCreated().
 *
 * The framework already handles: tenant record, runtimes (6), copilot agent.
 * This creates:
 * 1. Default sales pipeline + stages
 * 2. Email ingest workflow + routine (every 15 min)
 * 3. Calendar ingest workflow + routine (every 15 min)
 */
export async function provisionCrmTenant(db: PostgresJsDatabase, tenantId: string) {
  // 1. Default sales pipeline + stages
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

  // 2. Email ingest workflow
  // trigger → connector-action(list_emails) → for-each → create-inbox-item
  const emailWorkflowId = randomUUID();
  const emailBlocks = [
    { id: "trigger", name: "Start", type: "trigger", config: {} },
    {
      id: "fetch",
      name: "Fetch Emails",
      type: "connector-action",
      config: { connectorKind: "google", action: "list_emails", inputs: { maxResults: 20 } },
    },
    {
      id: "loop",
      name: "Process Each Email",
      type: "for-each",
      config: { items: "{{fetch.data.messages}}" },
    },
    {
      id: "store",
      name: "Store in Inbox",
      type: "create-inbox-item",
      config: { source: "gmail", items: "{{loop.items}}" },
    },
  ];
  const emailEdges = [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "fetch", targetBlockId: "loop", sourceHandle: null, sortOrder: 0 },
    { id: "e3", sourceBlockId: "loop", targetBlockId: "store", sourceHandle: null, sortOrder: 0 },
  ];

  await db.execute(sql`
    INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
    VALUES (${emailWorkflowId}, ${tenantId}, 'Email Sync', 'system', 'active',
      ${JSON.stringify(emailBlocks)}::jsonb, ${JSON.stringify(emailEdges)}::jsonb, now(), now())
  `);

  // Email sync routine — every 15 minutes
  await db.execute(sql`
    INSERT INTO routines (id, tenant_id, title, workflow_id, cron_expression, status, created_at, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, 'Email Sync (every 15 min)', ${emailWorkflowId},
      '*/15 * * * *', 'active', now(), now())
  `);

  // 3. Calendar ingest workflow
  // trigger → connector-action(list_events) → for-each → create-inbox-item
  const calWorkflowId = randomUUID();
  const calBlocks = [
    { id: "trigger", name: "Start", type: "trigger", config: {} },
    {
      id: "fetch",
      name: "Fetch Calendar Events",
      type: "connector-action",
      config: { connectorKind: "google", action: "list_events", inputs: { maxResults: 20 } },
    },
    {
      id: "loop",
      name: "Process Each Event",
      type: "for-each",
      config: { items: "{{fetch.data.events}}" },
    },
    {
      id: "store",
      name: "Store in Inbox",
      type: "create-inbox-item",
      config: { source: "calendar", items: "{{loop.items}}" },
    },
  ];
  const calEdges = [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "fetch", targetBlockId: "loop", sourceHandle: null, sortOrder: 0 },
    { id: "e3", sourceBlockId: "loop", targetBlockId: "store", sourceHandle: null, sortOrder: 0 },
  ];

  await db.execute(sql`
    INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
    VALUES (${calWorkflowId}, ${tenantId}, 'Calendar Sync', 'system', 'active',
      ${JSON.stringify(calBlocks)}::jsonb, ${JSON.stringify(calEdges)}::jsonb, now(), now())
  `);

  // Calendar sync routine — every 15 minutes
  await db.execute(sql`
    INSERT INTO routines (id, tenant_id, title, workflow_id, cron_expression, status, created_at, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, 'Calendar Sync (every 15 min)', ${calWorkflowId},
      '*/15 * * * *', 'active', now(), now())
  `);
}
