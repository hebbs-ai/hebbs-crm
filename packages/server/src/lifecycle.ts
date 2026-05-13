// SPDX-License-Identifier: BUSL-1.1
//
// CRM Module lifecycle hooks.
//
// `onInstall(ctx)` runs AFTER `Module.schema` migrations create
// the crm__* tables. It seeds the per-tenant defaults that turn a
// fresh install into a usable CRM:
//
//   - Default sales pipeline + stages
//   - Optional Slack connector (env-gated)
//   - 6 specialised agents (email-lens, enrichment x2, deal-analyst,
//     follow-up-writer, meeting-prep) — instructions are kept
//     minimal because the persona's SKILL.md (loaded by the
//     v2-skills context provider, gated by role frontmatter)
//     supplies the behavioural guidance
//   - 3 declared workflows + 5 system workflows
//   - 4 cron routines
//
// `onUninstall(ctx)` removes everything we seeded so a tenant can
// cleanly remove the CRM. Schema rollback is handled by the
// install-manager via `Module.schema[].down()`.

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  ModuleFactoryDeps,
  ModuleLifecycle,
} from "@boringos/module-sdk";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DEFAULT_PIPELINE_STAGES } from "@boringos-crm/shared";
import { pipelines, pipelineStages } from "./schema/pipelines.js";

const CRM_AGENT_ROLES = [
  "email-lens",
  "enrichment-contact",
  "enrichment-company",
  "deal-analyst",
  "follow-up-writer",
  "meeting-prep",
] as const;

const CRM_WORKFLOW_NAMES = [
  "Email Sync",
  "Calendar Check",
  "CRM lens on classified inbox items",
  "Activate sync routines on Google connect",
  "Prep upcoming meetings",
  "Enrich new contact",
  "Enrich new company",
  "Analyze new deal",
];

export function createCrmLifecycle(
  factoryDeps: ModuleFactoryDeps,
): ModuleLifecycle {
  const db = factoryDeps.db as PostgresJsDatabase;

  return {
    async onInstall(ctx) {
      const tenantId = ctx.tenantId;

      // Idempotency: if any prior install attempt left CRM agents /
      // workflows / routines behind, scrub them before seeding fresh.
      // Without this, repeated install calls would double-seed
      // (12 agents, 16 workflows, 8 routines after two installs).
      // Schema migrations are tracked separately so they no-op on
      // re-install — we only need to dedupe the lifecycle seeds.
      await scrubCrmSeeds(db, tenantId);

      await seedPipeline(db, tenantId);
      await seedSlack(db, tenantId);

      const runtimeId = await fetchClaudeRuntimeId(db, tenantId);
      if (!runtimeId) {
        console.warn(
          `[crm.onInstall] No Claude runtime for tenant ${tenantId} — skipping agent + workflow seed. Re-install once a runtime is provisioned.`,
        );
        return;
      }

      const rootAgentId = await fetchRootAgentId(db, tenantId);
      if (!rootAgentId) {
        console.warn(
          `[crm.onInstall] No root agent for tenant ${tenantId} — skipping agent + workflow seed. The framework's onTenantCreated should create one before CRM install.`,
        );
        return;
      }

      const agents = await seedAgents(db, tenantId, runtimeId, rootAgentId);
      await seedWorkflows(db, tenantId, agents);
      await seedRoutines(db, tenantId, agents);
    },

    async onUninstall(ctx) {
      const tenantId = ctx.tenantId;
      // Order matters — child rows first, then parents.
      //
      // Use sql.join for IN-list params: postgres-js doesn't convert
      // JS arrays to PG arrays for `= ANY(${arr})` automatically.

      const rolesIn = sql.join(
        CRM_AGENT_ROLES.map((r) => sql`${r}`),
        sql`, `,
      );
      const namesIn = sql.join(
        CRM_WORKFLOW_NAMES.map((n) => sql`${n}`),
        sql`, `,
      );

      // Routines targeting CRM agents OR CRM workflows.
      await db.execute(sql`
        DELETE FROM routines
        WHERE tenant_id = ${tenantId}
          AND (
            assignee_agent_id IN (
              SELECT id FROM agents
              WHERE tenant_id = ${tenantId}
                AND role IN (${rolesIn})
            )
            OR workflow_id IN (
              SELECT id FROM workflows
              WHERE tenant_id = ${tenantId}
                AND name IN (${namesIn})
            )
          )
      `);

      // workflow_runs has FK to workflows; clear those first.
      await db.execute(sql`
        DELETE FROM workflow_runs
        WHERE workflow_id IN (
          SELECT id FROM workflows
          WHERE tenant_id = ${tenantId}
            AND name IN (${namesIn})
        )
      `);

      await db.execute(sql`
        DELETE FROM workflows
        WHERE tenant_id = ${tenantId}
          AND name IN (${namesIn})
      `);

      // FK chain: cost_events → agent_runs → agent_wakeup_requests → agents.
      // Delete in reverse FK order. cost_events references run_id.
      await db.execute(sql`
        DELETE FROM cost_events
        WHERE run_id IN (
          SELECT id FROM agent_runs
          WHERE agent_id IN (
            SELECT id FROM agents
            WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
          )
        )
      `);
      await db.execute(sql`
        DELETE FROM agent_runs
        WHERE agent_id IN (
          SELECT id FROM agents
          WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
        )
      `);
      await db.execute(sql`
        DELETE FROM agent_wakeup_requests
        WHERE agent_id IN (
          SELECT id FROM agents
          WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
        )
      `);
      // Tasks created by these agents (assignee_agent_id or created_by_agent_id).
      await db.execute(sql`
        UPDATE tasks SET assignee_agent_id = NULL
        WHERE assignee_agent_id IN (
          SELECT id FROM agents
          WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
        )
      `);
      await db.execute(sql`
        UPDATE tasks SET created_by_agent_id = NULL
        WHERE created_by_agent_id IN (
          SELECT id FROM agents
          WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
        )
      `);

      await db.execute(sql`
        DELETE FROM agents
        WHERE tenant_id = ${tenantId}
          AND role IN (${rolesIn})
      `);

      // Slack is shared infra — leave it. Pipelines + stages get
      // dropped via Migration.down() in the install-manager.
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Idempotency scrub — removes any leftover CRM rows before a fresh
// install seeds them again. Called at the top of onInstall.
// Mirrors onUninstall's cascade except it doesn't drop the schema
// (the schema migration is tracked separately).
// ─────────────────────────────────────────────────────────────────

async function scrubCrmSeeds(db: PostgresJsDatabase, tenantId: string) {
  const rolesIn = sql.join(
    CRM_AGENT_ROLES.map((r) => sql`${r}`),
    sql`, `,
  );
  const namesIn = sql.join(
    CRM_WORKFLOW_NAMES.map((n) => sql`${n}`),
    sql`, `,
  );

  // Same FK-respecting order as onUninstall:
  //   cost_events → agent_runs → agent_wakeup_requests → agents
  //   workflow_runs → workflows
  //   routines (free-standing FKs to agents and workflows)

  await db.execute(sql`
    DELETE FROM routines
    WHERE tenant_id = ${tenantId}
      AND (
        assignee_agent_id IN (
          SELECT id FROM agents
          WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
        )
        OR workflow_id IN (
          SELECT id FROM workflows
          WHERE tenant_id = ${tenantId} AND name IN (${namesIn})
        )
      )
  `);
  await db.execute(sql`
    DELETE FROM cost_events
    WHERE run_id IN (
      SELECT id FROM agent_runs
      WHERE agent_id IN (
        SELECT id FROM agents
        WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
      )
    )
  `);
  await db.execute(sql`
    DELETE FROM agent_runs
    WHERE agent_id IN (
      SELECT id FROM agents
      WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
    )
  `);
  await db.execute(sql`
    DELETE FROM agent_wakeup_requests
    WHERE agent_id IN (
      SELECT id FROM agents
      WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
    )
  `);
  await db.execute(sql`
    DELETE FROM workflow_runs
    WHERE workflow_id IN (
      SELECT id FROM workflows
      WHERE tenant_id = ${tenantId} AND name IN (${namesIn})
    )
  `);
  await db.execute(sql`
    DELETE FROM workflows
    WHERE tenant_id = ${tenantId} AND name IN (${namesIn})
  `);
  await db.execute(sql`
    UPDATE tasks SET assignee_agent_id = NULL
    WHERE assignee_agent_id IN (
      SELECT id FROM agents
      WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
    )
  `);
  await db.execute(sql`
    UPDATE tasks SET created_by_agent_id = NULL
    WHERE created_by_agent_id IN (
      SELECT id FROM agents
      WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
    )
  `);
  await db.execute(sql`
    DELETE FROM agents
    WHERE tenant_id = ${tenantId} AND role IN (${rolesIn})
  `);
}

// ─────────────────────────────────────────────────────────────────
// Seed helpers
// ─────────────────────────────────────────────────────────────────

// Idempotent: re-install must not duplicate the default pipeline /
// its stages. The 005-default-pipeline-uniq partial index now hard-
// enforces "one default per tenant"; without this short-circuit, the
// second install would fail at the INSERT instead of no-oping.
async function seedPipeline(db: PostgresJsDatabase, tenantId: string) {
  const existing = (await db.execute(sql`
    SELECT id FROM crm__pipelines
    WHERE tenant_id = ${tenantId} AND is_default = true
    LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  if (existing[0]) {
    // Pipeline + stages already seeded — leave them alone so we don't
    // stomp on user-renamed stages or break deals pointing at the
    // existing stage_ids.
    return;
  }

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
}

async function seedSlack(db: PostgresJsDatabase, tenantId: string) {
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  if (!slackBotToken) return;
  await db.execute(sql`
    INSERT INTO connectors (id, tenant_id, kind, status, config, credentials, created_at, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, 'slack', 'active', '{}',
      ${JSON.stringify({ accessToken: slackBotToken })}::jsonb, now(), now())
  `);
}

async function fetchClaudeRuntimeId(
  db: PostgresJsDatabase,
  tenantId: string,
): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT id FROM runtimes
    WHERE tenant_id = ${tenantId} AND type = 'claude'
    LIMIT 1
  `);
  const row = (result as unknown as Array<{ id: string }>)[0];
  return row?.id ?? null;
}

// Every CRM agent reports to the tenant's existing root agent
// (typically the copilot). The framework enforces "one root per
// tenant" via a unique partial index on agents(tenant_id) WHERE
// reports_to IS NULL — so we must NOT seed CRM agents with a NULL
// reports_to, or install fails on the second agent.
async function fetchRootAgentId(
  db: PostgresJsDatabase,
  tenantId: string,
): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT id FROM agents
    WHERE tenant_id = ${tenantId} AND reports_to IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const row = (result as unknown as Array<{ id: string }>)[0];
  return row?.id ?? null;
}

interface SeededAgents {
  emailLensId: string;
  enrichmentContactId: string;
  enrichmentCompanyId: string;
  dealAnalystId: string;
  followUpId: string;
  meetingPrepId: string;
}

async function seedAgents(
  db: PostgresJsDatabase,
  tenantId: string,
  runtimeId: string,
  rootAgentId: string,
): Promise<SeededAgents> {
  const ids: SeededAgents = {
    emailLensId: randomUUID(),
    enrichmentContactId: randomUUID(),
    enrichmentCompanyId: randomUUID(),
    dealAnalystId: randomUUID(),
    followUpId: randomUUID(),
    meetingPrepId: randomUUID(),
  };

  // SKILL.md (loaded by v2-skills via the role gate) carries the
  // behavioural prompt. Per-instance instructions stay empty.
  const instructions = "";

  const seeds: Array<[string, string, string]> = [
    [ids.emailLensId, "CRM Email Lens", "email-lens"],
    [ids.enrichmentContactId, "Contact Enrichment", "enrichment-contact"],
    [ids.enrichmentCompanyId, "Company Enrichment", "enrichment-company"],
    [ids.dealAnalystId, "Deal Analyst", "deal-analyst"],
    [ids.followUpId, "Follow-up Writer", "follow-up-writer"],
    [ids.meetingPrepId, "Meeting Prep", "meeting-prep"],
  ];

  for (const [id, name, role] of seeds) {
    await db.execute(sql`
      INSERT INTO agents (id, tenant_id, name, role, status, instructions, runtime_id, reports_to, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${name}, ${role}, 'idle', ${instructions}, ${runtimeId}, ${rootAgentId}, now(), now())
    `);
  }

  return ids;
}

// ─────────────────────────────────────────────────────────────────
// Workflows
//
// Block / edge JSON kept identical to v1 tenant.ts so the
// framework's workflow engine consumes them unchanged. When the
// framework engine cuts over to v2 module-sdk's
// `WorkflowBlock` (`kind: "trigger" | "tool" | ...`), this whole
// section gets rewritten in one pass.
// ─────────────────────────────────────────────────────────────────

async function seedWorkflows(
  db: PostgresJsDatabase,
  tenantId: string,
  agents: SeededAgents,
): Promise<{ emailWorkflowId: string; calCheckWorkflowId: string }> {
  const emailLensAgentId = agents.emailLensId;
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
  await insertWorkflow(db, tenantId, emailWorkflowId, "Email Sync", emailBlocks, emailEdges);

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
  await insertWorkflow(db, tenantId, calCheckWorkflowId, "Calendar Check", calCheckBlocks, calCheckEdges);

  // CRM Email Lens — wakes on triage.classified. v2 block model:
  // a `tool` block calling framework.agents.wake with the seeded
  // agent id baked in.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "CRM lens on classified inbox items",
    [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "triage.classified" } },
      {
        id: "wake",
        name: "wake",
        kind: "tool",
        type: "tool",
        tool: "framework.agents.wake",
        inputs: { agentId: emailLensAgentId, reason: "triage_classified" },
        config: {},
      },
    ],
    [{ id: "e1", sourceBlockId: "trigger", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 }],
  );

  // Activate sync routines on Google connect.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Activate sync routines on Google connect",
    [
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
    ],
    [
      // The framework's workflow engine sets selectedHandle to "true"/"false"
      // after a condition block (workflow.ts:353); "condition-true" used to
      // be silently pruned, which left Email Sync + Calendar Check paused
      // forever after the user connected Google.
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "guard", targetBlockId: "unpause_sync", sourceHandle: "true", sortOrder: 0 },
      { id: "e3", sourceBlockId: "guard", targetBlockId: "unpause_calendar", sourceHandle: "true", sortOrder: 1 },
    ],
  );

  // Meeting prep workflow.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Prep upcoming meetings",
    [
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
    ],
    [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "loop", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "loop", targetBlockId: "task", sourceHandle: null, sortOrder: 0 },
      { id: "e3", sourceBlockId: "task", targetBlockId: "wake", sourceHandle: null, sortOrder: 0 },
    ],
  );

  // Enrich new contact / company / Analyze new deal — v2 tool
  // blocks. The framework.tasks.create tool auto-wakes the
  // assigneeAgentId, so create-task + wake-agent collapse into one
  // tool call.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Enrich new contact",
    entityCreatedBlocks(
      "crm_contact",
      "Enrich contact",
      "Research and enrich contact: {{trigger.entityId}}",
      "agent-enrichment",
      agents.enrichmentContactId,
    ),
    entityCreatedEdges(),
  );

  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Enrich new company",
    entityCreatedBlocks(
      "crm_company",
      "Enrich company",
      "Research and enrich company: {{trigger.entityId}}",
      "agent-enrichment",
      agents.enrichmentCompanyId,
    ),
    entityCreatedEdges(),
  );

  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Analyze new deal",
    entityCreatedBlocks(
      "crm_deal",
      "Analyze new deal",
      "Analyze deal: {{trigger.entityId}}\nThis is an event-driven wake for a single new deal. Produce agentIntelligence for just this deal and mark this task done.",
      "agent-deal-analysis",
      agents.dealAnalystId,
    ),
    entityCreatedEdges(),
  );

  return { emailWorkflowId, calCheckWorkflowId };
}

function entityCreatedBlocks(
  entityType: string,
  taskTitle: string,
  taskDescription: string,
  originKind: string,
  assigneeAgentId: string,
) {
  return [
    { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "entity.created" } },
    {
      id: "guard",
      name: "guard",
      kind: "condition",
      type: "condition",
      config: { field: "{{trigger.entityType}}", operator: "equals", value: entityType },
    },
    {
      id: "task",
      name: "task",
      kind: "tool",
      type: "tool",
      tool: "framework.tasks.create",
      inputs: {
        title: taskTitle,
        description: taskDescription,
        originKind,
        assigneeAgentId,
      },
      config: {},
    },
  ];
}

function entityCreatedEdges() {
  return [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "guard", targetBlockId: "task", sourceHandle: "true", sortOrder: 0 },
  ];
}

async function insertWorkflow(
  db: PostgresJsDatabase,
  tenantId: string,
  id: string,
  name: string,
  blocks: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
) {
  await db.execute(sql`
    INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
    VALUES (${id}, ${tenantId}, ${name}, 'system', 'active',
      ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
  `);
}

// ─────────────────────────────────────────────────────────────────
// Routines (paused for the connector-gated ones until Google
// auth lands; the "Activate sync routines on Google connect"
// workflow flips them to active when the user connects).
// ─────────────────────────────────────────────────────────────────

async function seedRoutines(
  db: PostgresJsDatabase,
  tenantId: string,
  agents: SeededAgents,
) {
  // We need workflow IDs for the cron-driven workflow routines.
  // Look them up by name — already inserted above.
  const lookup = async (name: string): Promise<string | null> => {
    const r = await db.execute(sql`
      SELECT id FROM workflows
      WHERE tenant_id = ${tenantId} AND name = ${name}
      LIMIT 1
    `);
    return (r as unknown as Array<{ id: string }>)[0]?.id ?? null;
  };

  const emailWorkflowId = await lookup("Email Sync");
  const calWorkflowId = await lookup("Calendar Check");

  if (emailWorkflowId) {
    await db.execute(sql`
      INSERT INTO routines (id, tenant_id, title, workflow_id, cron_expression, status, created_at, updated_at)
      VALUES (${randomUUID()}, ${tenantId}, 'Email Sync (every 15 min)', ${emailWorkflowId},
        '*/15 * * * *', 'paused', now(), now())
    `);
  }

  if (calWorkflowId) {
    await db.execute(sql`
      INSERT INTO routines (id, tenant_id, title, workflow_id, cron_expression, status, created_at, updated_at)
      VALUES (${randomUUID()}, ${tenantId}, 'Calendar Check (every 30 min)', ${calWorkflowId},
        '*/30 * * * *', 'paused', now(), now())
    `);
  }

  // Daily agent-targeted routines (active immediately).
  await db.execute(sql`
    INSERT INTO routines (id, tenant_id, title, assignee_agent_id, cron_expression, status, created_at, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, 'Deal Analysis (daily)', ${agents.dealAnalystId},
      '0 6 * * *', 'active', now(), now())
  `);

  await db.execute(sql`
    INSERT INTO routines (id, tenant_id, title, assignee_agent_id, cron_expression, status, created_at, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, 'Follow-up Drafts (daily)', ${agents.followUpId},
      '0 7 * * *', 'active', now(), now())
  `);
}
