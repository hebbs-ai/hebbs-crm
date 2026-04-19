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
    { id: "trigger", name: "trigger", type: "trigger", config: {} },
    {
      id: "fetch",
      name: "fetch",
      type: "connector-action",
      config: { connectorKind: "google", action: "list_emails", inputs: { maxResults: 20 } },
    },
    {
      id: "loop",
      name: "loop",
      type: "for-each",
      config: { items: "{{fetch.messages}}" },
    },
    {
      id: "store",
      name: "store",
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

  // 3. Calendar check workflow — fetches upcoming events, emits events for CRM to dedup + wake agent
  const calCheckWorkflowId = randomUUID();
  const calCheckBlocks = [
    { id: "trigger", name: "trigger", type: "trigger", config: {} },
    {
      id: "fetch",
      name: "fetch",
      type: "connector-action",
      config: { connectorKind: "google", action: "list_events", inputs: { maxResults: 10, timeMin: "NOW" } },
    },
    {
      id: "emit",
      name: "emit",
      type: "emit-event",
      config: {
        connectorKind: "calendar",
        eventType: "calendar.upcoming_events",
        data: { events: "{{fetch.events}}" },
      },
    },
  ];
  const calCheckEdges = [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "fetch", targetBlockId: "emit", sourceHandle: null, sortOrder: 0 },
  ];

  await db.execute(sql`
    INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
    VALUES (${calCheckWorkflowId}, ${tenantId}, 'Calendar Check', 'system', 'active',
      ${JSON.stringify(calCheckBlocks)}::jsonb, ${JSON.stringify(calCheckEdges)}::jsonb, now(), now())
  `);

  // Calendar check routine — every 30 min, paused until Google connected
  await db.execute(sql`
    INSERT INTO routines (id, tenant_id, title, workflow_id, cron_expression, status, created_at, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, 'Calendar Check (every 30 min)', ${calCheckWorkflowId},
      '*/30 * * * *', 'paused', now(), now())
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

  // 5. Create Email Triage agent + event-triggered workflow that wakes it
  try {
    const { EMAIL_TRIAGE_INSTRUCTIONS } = await import("./agents/email-triage.js");
    const rtResult = await db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
    `);
    const runtimeId = (rtResult as unknown as Array<{ id: string }>)[0]?.id;
    if (runtimeId) {
      const emailTriageAgentId = randomUUID();
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${emailTriageAgentId}, ${tenantId}, 'Email Triage', 'email-triage', 'idle',
          ${EMAIL_TRIAGE_INSTRUCTIONS}, ${runtimeId}, now(), now())
      `);

      // Replaces the previous inline `app.onEvent("inbox.item_created")` hand-
      // rolled dispatch. The framework's event-dispatch primitive picks up
      // any active workflow whose trigger.eventType matches the incoming
      // event and executes it with the event payload. One wake per batch —
      // the agent's wake-coalescing keeps things from piling up.
      const triageWfBlocks = [
        { id: "trigger", name: "trigger", type: "trigger", config: { eventType: "inbox.item_created" } },
        { id: "wake", name: "wake", type: "wake-agent", config: { agentId: emailTriageAgentId, reason: "inbox_item_created" } },
      ];
      const triageWfEdges = [
        { id: "e1", sourceBlockId: "trigger", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 },
      ];
      await db.execute(sql`
        INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Triage new inbox items', 'system', 'active',
          ${JSON.stringify(triageWfBlocks)}::jsonb, ${JSON.stringify(triageWfEdges)}::jsonb, now(), now())
      `);
    }
  } catch (err) {
    console.warn(`[tenant] Failed to create Email Triage agent:`, err);
  }

  // 6. Create Enrichment agents (contact + company dossier)
  try {
    const { CONTACT_DOSSIER_INSTRUCTIONS, COMPANY_DOSSIER_INSTRUCTIONS } = await import("./agents/enrichment.js");
    const rtResult2 = await db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
    `);
    const runtimeId2 = (rtResult2 as unknown as Array<{ id: string }>)[0]?.id;
    if (runtimeId2) {
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Contact Enrichment', 'enrichment-contact', 'idle',
          ${CONTACT_DOSSIER_INSTRUCTIONS}, ${runtimeId2}, now(), now())
      `);
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Company Enrichment', 'enrichment-company', 'idle',
          ${COMPANY_DOSSIER_INSTRUCTIONS}, ${runtimeId2}, now(), now())
      `);
    }
  } catch (err) {
    console.warn(`[tenant] Failed to create Enrichment agents:`, err);
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

  // 8. Create Follow-up Writer agent + daily routine
  try {
    const { FOLLOW_UP_WRITER_INSTRUCTIONS } = await import("./agents/follow-up-writer.js");
    const rtResult4 = await db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
    `);
    const runtimeId4 = (rtResult4 as unknown as Array<{ id: string }>)[0]?.id;
    if (runtimeId4) {
      const followUpId = randomUUID();
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${followUpId}, ${tenantId}, 'Follow-up Writer', 'follow-up-writer', 'idle',
          ${FOLLOW_UP_WRITER_INSTRUCTIONS}, ${runtimeId4}, now(), now())
      `);

      // Daily routine at 7 AM UTC (after Deal Analyst at 6 AM)
      await db.execute(sql`
        INSERT INTO routines (id, tenant_id, title, assignee_agent_id, cron_expression, status, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Follow-up Drafts (daily)', ${followUpId},
          '0 7 * * *', 'active', now(), now())
      `);
    }
  } catch (err) {
    console.warn(`[tenant] Failed to create Follow-up Writer agent:`, err);
  }

  // 9. Create Meeting Prep agent (no direct routine — Calendar Check workflow triggers it via events)
  try {
    const { MEETING_PREP_INSTRUCTIONS } = await import("./agents/meeting-prep.js");
    const rtResult5 = await db.execute(sql`
      SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
    `);
    const runtimeId5 = (rtResult5 as unknown as Array<{ id: string }>)[0]?.id;
    if (runtimeId5) {
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, 'Meeting Prep', 'meeting-prep', 'idle',
          ${MEETING_PREP_INSTRUCTIONS}, ${runtimeId5}, now(), now())
      `);
    }
  } catch (err) {
    console.warn(`[tenant] Failed to create Meeting Prep agent:`, err);
  }

  // 10. Event-triggered system workflows replacing the last 3 onEvent dispatchers.
  //     Each subscribes via trigger.config.eventType. The framework's event
  //     dispatcher matches incoming events against active workflows in the
  //     tenant and fires every match.

  // 10a. Activate Google sync routines when the connector connects.
  await seedSystemWorkflow(db, tenantId, "Activate sync routines on Google connect", [
    { id: "trigger", name: "trigger", type: "trigger", config: { eventType: "connector.connected" } },
    {
      id: "guard",
      name: "guard",
      type: "condition",
      config: { field: "{{trigger.kind}}", operator: "equals", value: "google" },
    },
    {
      id: "unpause_sync",
      name: "unpause_sync",
      type: "update-row",
      config: {
        table: "routines",
        where: { status: "paused", title: { op: "ilike", value: "%Sync%" } },
        set: { status: "active" },
      },
    },
    {
      id: "unpause_calendar",
      name: "unpause_calendar",
      type: "update-row",
      config: {
        table: "routines",
        where: { status: "paused", title: { op: "ilike", value: "%Calendar Check%" } },
        set: { status: "active" },
      },
    },
  ], [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "guard", targetBlockId: "unpause_sync", sourceHandle: "condition-true", sortOrder: 0 },
    { id: "e3", sourceBlockId: "guard", targetBlockId: "unpause_calendar", sourceHandle: "condition-true", sortOrder: 1 },
  ]);

  // 10b. Wake meeting-prep agent for each upcoming calendar event, deduped by event id.
  //      The for-each fans out over trigger.events; create-task uses dedup so the
  //      same calendar event id never piles up tasks.
  await seedSystemWorkflow(db, tenantId, "Prep upcoming meetings", [
    { id: "trigger", name: "trigger", type: "trigger", config: { eventType: "calendar.upcoming_events" } },
    { id: "loop", name: "loop", type: "for-each", config: { items: "{{trigger.events}}" } },
    {
      id: "task",
      name: "task",
      type: "create-task",
      config: {
        title: "Meeting prep: {{loop.summary}}",
        description: "Prep for {{loop.summary}} starting {{loop.start.dateTime}}",
        originKind: "agent-meeting-prep",
        originId: "{{loop.id}}",
        dedup: true,
      },
    },
    {
      id: "wake",
      name: "wake",
      type: "wake-agent",
      config: { agentRole: "meeting-prep", reason: "calendar_event", taskId: "{{task.taskId}}" },
    },
  ], [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "loop", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "loop", targetBlockId: "task", sourceHandle: null, sortOrder: 0 },
    { id: "e3", sourceBlockId: "task", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 },
  ]);

  // 10c. Enrich/analyze on entity creation. One workflow per entity type since
  //      our condition block doesn't yet have multi-arm switch — three top-level
  //      branches keeps each readable in the visual editor.
  await seedSystemWorkflow(db, tenantId, "Enrich new contact", [
    { id: "trigger", name: "trigger", type: "trigger", config: { eventType: "entity.created" } },
    {
      id: "guard",
      name: "guard",
      type: "condition",
      config: { field: "{{trigger.entityType}}", operator: "equals", value: "crm_contact" },
    },
    {
      id: "task",
      name: "task",
      type: "create-task",
      config: {
        title: "Enrich contact",
        description: "Research and enrich contact: {{trigger.entityId}}",
        originKind: "agent-enrichment",
        originId: "{{trigger.entityId}}",
        dedup: true,
      },
    },
    {
      id: "wake",
      name: "wake",
      type: "wake-agent",
      config: { agentRole: "enrichment-contact", reason: "entity_created", taskId: "{{task.taskId}}" },
    },
  ], [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "guard", targetBlockId: "task", sourceHandle: "condition-true", sortOrder: 0 },
    { id: "e3", sourceBlockId: "task", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 },
  ]);

  await seedSystemWorkflow(db, tenantId, "Enrich new company", [
    { id: "trigger", name: "trigger", type: "trigger", config: { eventType: "entity.created" } },
    {
      id: "guard",
      name: "guard",
      type: "condition",
      config: { field: "{{trigger.entityType}}", operator: "equals", value: "crm_company" },
    },
    {
      id: "task",
      name: "task",
      type: "create-task",
      config: {
        title: "Enrich company",
        description: "Research and enrich company: {{trigger.entityId}}",
        originKind: "agent-enrichment",
        originId: "{{trigger.entityId}}",
        dedup: true,
      },
    },
    {
      id: "wake",
      name: "wake",
      type: "wake-agent",
      config: { agentRole: "enrichment-company", reason: "entity_created", taskId: "{{task.taskId}}" },
    },
  ], [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "guard", targetBlockId: "task", sourceHandle: "condition-true", sortOrder: 0 },
    { id: "e3", sourceBlockId: "task", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 },
  ]);

  await seedSystemWorkflow(db, tenantId, "Analyze new deal", [
    { id: "trigger", name: "trigger", type: "trigger", config: { eventType: "entity.created" } },
    {
      id: "guard",
      name: "guard",
      type: "condition",
      config: { field: "{{trigger.entityType}}", operator: "equals", value: "crm_deal" },
    },
    {
      id: "task",
      name: "task",
      type: "create-task",
      config: {
        title: "Analyze new deal",
        description: "Analyze deal: {{trigger.entityId}}\nThis is an event-driven wake for a single new deal. Produce agentIntelligence for just this deal and mark this task done.",
        originKind: "agent-deal-analysis",
        originId: "{{trigger.entityId}}",
        dedup: true,
      },
    },
    {
      id: "wake",
      name: "wake",
      type: "wake-agent",
      config: { agentRole: "deal-analyst", reason: "entity_created", taskId: "{{task.taskId}}" },
    },
  ], [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "guard", targetBlockId: "task", sourceHandle: "condition-true", sortOrder: 0 },
    { id: "e3", sourceBlockId: "task", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 },
  ]);
}

// Helper to seed a system workflow so each block above stays readable.
async function seedSystemWorkflow(
  db: PostgresJsDatabase,
  tenantId: string,
  name: string,
  blocks: Array<{ id: string; name: string; type: string; config: Record<string, unknown> }>,
  edges: Array<{ id: string; sourceBlockId: string; targetBlockId: string; sourceHandle: string | null; sortOrder: number }>,
) {
  await db.execute(sql`
    INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, ${name}, 'system', 'active',
      ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
  `);
}
