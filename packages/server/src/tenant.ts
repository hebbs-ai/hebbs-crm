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
      '*/15 * * * *', 'paused', now(), now())
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
      '*/15 * * * *', 'paused', now(), now())
  `);

  // 4. Auto-connect Slack if bot token is configured (server-level)
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  if (slackBotToken) {
    await db.execute(sql`
      INSERT INTO connectors (id, tenant_id, kind, status, config, credentials, created_at, updated_at)
      VALUES (${randomUUID()}, ${tenantId}, 'slack', 'active', '{}',
        ${JSON.stringify({ accessToken: slackBotToken })}::jsonb, now(), now())
    `);
  }

  // 5. Create Email Triage agent
  // Framework already created copilot + runtimes. We create additional CRM agents.
  try {
    const { EMAIL_TRIAGE_INSTRUCTIONS } = await import("./agents/email-triage.js");
    // Find the Claude runtime for this tenant
    const rtResult = await db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
    `);
    const runtimeId = (rtResult as unknown as Array<{ id: string }>)[0]?.id;
    if (runtimeId) {
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Email Triage', 'email-triage', 'idle',
          ${EMAIL_TRIAGE_INSTRUCTIONS}, ${runtimeId}, now(), now())
      `);
    }
  } catch (err) {
    console.warn(`[tenant] Failed to create Email Triage agent:`, err);
  }

  // 6. Create Enrichment agent
  try {
    const { ENRICHMENT_INSTRUCTIONS } = await import("./agents/enrichment.js");
    const rtResult2 = await db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
    `);
    const runtimeId2 = (rtResult2 as unknown as Array<{ id: string }>)[0]?.id;
    if (runtimeId2) {
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Enrichment', 'enrichment', 'idle',
          ${ENRICHMENT_INSTRUCTIONS}, ${runtimeId2}, now(), now())
      `);
    }
  } catch (err) {
    console.warn(`[tenant] Failed to create Enrichment agent:`, err);
  }

  // 7. Create Deal Analyst agent + daily routine
  try {
    const { DEAL_ANALYST_INSTRUCTIONS } = await import("./agents/deal-analyst.js");
    const rtResult3 = await db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
    `);
    const runtimeId3 = (rtResult3 as unknown as Array<{ id: string }>)[0]?.id;
    if (runtimeId3) {
      const dealAnalystId = randomUUID();
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${dealAnalystId}, ${tenantId}, 'Deal Analyst', 'deal-analyst', 'idle',
          ${DEAL_ANALYST_INSTRUCTIONS}, ${runtimeId3}, now(), now())
      `);

      // Daily routine at 6 AM UTC
      await db.execute(sql`
        INSERT INTO routines (id, tenant_id, title, assignee_agent_id, cron_expression, status, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Deal Analysis (daily)', ${dealAnalystId},
          '0 6 * * *', 'active', now(), now())
      `);
    }
  } catch (err) {
    console.warn(`[tenant] Failed to create Deal Analyst agent:`, err);
  }
}
