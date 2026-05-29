// SPDX-License-Identifier: GPL-3.0-or-later
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
  AgentSeed,
  ModuleFactoryDeps,
  ModuleLifecycle,
} from "@boringos/module-sdk";
import { Lifecycle } from "@boringos/module-sdk";
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
  "crm-maintenance",
] as const;

const CRM_WORKFLOW_NAMES = [
  "Email Sync",
  "Calendar Check",
  "CRM lens on classified inbox items",
  "Activate sync routines on Google connect",
  // "Prep upcoming meetings" was folded into Calendar Check in v0.3 —
  // kept in the uninstall list so old installs still get cleaned up
  // on re-install via scrubCrmSeeds().
  "Prep upcoming meetings",
  "Enrich new contact",
  "Enrich new company",
  "Analyze new deal",
  // Phase 3 — ICP-gated lead creation.
  "Classify and create lead",
  // Phase 4 — deal creation gated on user reply.
  "Create deal on reply",
];

export function createCrmLifecycle(
  factoryDeps: ModuleFactoryDeps,
): ModuleLifecycle {
  const db = factoryDeps.db as PostgresJsDatabase;

  return {
    async onInstall(ctx) {
      const tenantId = ctx.tenantId;

      // MDK T8.3 — agents migrated to Lifecycle.seed. The framework's
      // __seed_meta + content-hash idempotency replaces the heavy
      // scrubCrmSeeds prelude for the agents path. Workflows +
      // routines still need scrub-then-insert because they reference
      // agent ids the framework's runSeed doesn't yet return; that
      // migration rides on a future SeedResult enhancement.
      await scrubCrmSeeds(db, tenantId, { keepAgents: true });

      await seedPipeline(db, tenantId);

      // Runtime is host-wide via BORINGOS_RUNTIME — no per-tenant
      // runtime lookup needed. Lifecycle.seed inserts agents with
      // runtime_id = null; engine resolves at wake.
      const agentSeeds = buildCrmAgentSeeds();
      await Lifecycle.seed(ctx, { agents: agentSeeds });

      // The remaining seeders still need the seeded agent ids to
      // wire governing_agent_id / assignee_agent_id, so we re-fetch
      // them here. T8.4 may expose a richer SeedResult for chained
      // references; until then, look up via (tenantId, source_app_id).
      const agents = await fetchSeededCrmAgentIds(db, tenantId);
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

async function scrubCrmSeeds(
  db: PostgresJsDatabase,
  tenantId: string,
  opts: { keepAgents?: boolean } = {},
) {
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
  // MDK T8.3 — agents migrated to Lifecycle.seed, which handles its
  // own idempotency via __seed_meta. Skip the agent cascade unless
  // the caller explicitly requests it (e.g. onUninstall).
  if (opts.keepAgents) return;
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

// MDK T8.3 — declarative CRM agent definitions. Lifecycle.seed
// resolves runtime + reportsTo, so we just describe what we want.
// `seedId` defaults to `name` in @boringos/module-sdk's runSeed; the
// names below are stable across versions so the upgrade-policy thread
// (T7.2) follows the right row.
function buildCrmAgentSeeds(): AgentSeed[] {
  const instructions = ""; // SKILL.md carries behaviour
  return [
    { name: "CRM Email Lens", persona: "email-lens", instructions },
    { name: "Contact Enrichment", persona: "enrichment-contact", instructions },
    { name: "Company Enrichment", persona: "enrichment-company", instructions },
    { name: "Deal Analyst", persona: "deal-analyst", instructions },
    { name: "Follow-up Writer", persona: "follow-up-writer", instructions },
    { name: "Meeting Prep", persona: "meeting-prep", instructions },
    { name: "CRM Maintenance", persona: "crm-maintenance", instructions },
  ];
}

// Re-fetch the agent ids Lifecycle.seed wrote so seedWorkflows /
// seedRoutines can wire governing_agent_id / assignee_agent_id. The
// framework currently doesn't expose the name→id map from
// Lifecycle.seed; a future SeedResult enhancement would let us
// thread these without the extra round-trip.
async function fetchSeededCrmAgentIds(
  db: PostgresJsDatabase,
  tenantId: string,
): Promise<SeededAgents> {
  const rows = (await db.execute(sql`
    SELECT id, role FROM agents
    WHERE tenant_id = ${tenantId}
      AND source = 'app'
      AND source_app_id = 'crm'
  `)) as unknown as Array<{ id: string; role: string }>;
  const byRole = new Map(rows.map((r) => [r.role, r.id]));
  const need = (role: string) => {
    const id = byRole.get(role);
    if (!id)
      throw new Error(
        `[crm.onInstall] expected agent role "${role}" missing after Lifecycle.seed`,
      );
    return id;
  };
  return {
    emailLensId: need("email-lens"),
    enrichmentContactId: need("enrichment-contact"),
    enrichmentCompanyId: need("enrichment-company"),
    dealAnalystId: need("deal-analyst"),
    followUpId: need("follow-up-writer"),
    meetingPrepId: need("meeting-prep"),
    maintenanceId: need("crm-maintenance"),
  };
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

// MDK T8.3 — seedSlack removed. Wrote to the legacy v1 `connectors`
// table (single row per provider). The current path is the v2
// AuthManager + connector_accounts, exposed via
// `/api/connectors/oauth/slack/authorize`. The env-gated bot-token
// shortcut never worked in production with v2.

// Every CRM agent reports to the tenant's existing root agent
// (typically the copilot). The framework enforces "one root per
// tenant" via a unique partial index on agents(tenant_id) WHERE
// reports_to IS NULL — so we must NOT seed CRM agents with a NULL
// reports_to, or install fails on the second agent.
// MDK T8.3 — fetchRootAgentId + seedAgents removed; Lifecycle.seed
// (in @boringos/agent's install-manager) handles root-agent lookup
// and the FK-safe inserts now. Workflow / routine seeds still need
// the agent ids; they come back via `fetchSeededCrmAgentIds`.

interface SeededAgents {
  emailLensId: string;
  enrichmentContactId: string;
  enrichmentCompanyId: string;
  dealAnalystId: string;
  followUpId: string;
  meetingPrepId: string;
  maintenanceId: string;
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
): Promise<{ calCheckWorkflowId: string }> {
  const emailLensAgentId = agents.emailLensId;

  // Gmail ingestion is owned by the framework forward-sync ticker now;
  // the CRM reacts to its `inbox.item_created` event via the "Enrich
  // inbox items on ingestion" workflow (below) instead of running its
  // own poller. No CRM-side Email Sync workflow/routine. `crm.inbox.sync`
  // survives only as a manual "sync now" tool. See hebbs-ai/hebbs-crm#10.

  // Calendar Check — same collapse pattern. `crm.calendar.sync_prep`
  // lists upcoming events and seeds one task per event with the
  // meeting-prep agent pre-assigned (the framework's task runner
  // wakes the assignee on its own).
  const calCheckWorkflowId = randomUUID();
  await insertWorkflow(
    db,
    tenantId,
    calCheckWorkflowId,
    "Calendar Check",
    [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: {} },
      {
        id: "sync",
        name: "sync",
        kind: "tool",
        type: "tool",
        tool: "crm.calendar.sync_prep",
        inputs: { maxResults: 10, lookaheadHours: 24 },
        config: {},
      },
    ],
    [{ id: "e1", sourceBlockId: "trigger", targetBlockId: "sync", sourceHandle: null, sortOrder: 0 }],
  );

  // CRM Email Lens — wakes on triage.classified, but only for
  // actionable labels (urgent/important), so we don't spawn the lens
  // agent on fyi/noise. Wakes via framework.tasks.create (assignee =
  // email-lens) rather than bare framework.agents.wake: the framework
  // requires every agent run to be bound to a task, and tasks.create
  // auto-wakes the assignee. The lens reads the itemId from the task
  // description (`inbox-item-id:` line), same convention as triage.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "CRM lens on classified inbox items",
    [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "triage.classified" } },
      {
        id: "guard-label",
        name: "guard-label",
        kind: "condition",
        type: "condition",
        config: { field: "{{trigger.label}}", operator: "in", value: ["urgent", "important"] },
      },
      {
        id: "lens",
        name: "lens",
        kind: "tool",
        type: "tool",
        tool: "framework.tasks.create",
        inputs: {
          title: "CRM lens: inbox item {{trigger.itemId}}",
          description:
            "inbox-item-id: {{trigger.itemId}}\ntriage-label: {{trigger.label}}\nrationale: {{trigger.rationale}}",
          originKind: "triage.classified",
          originId: "{{trigger.itemId}}",
          assigneeAgentId: emailLensAgentId,
        },
        config: {},
      },
    ],
    [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard-label", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "guard-label", targetBlockId: "lens", sourceHandle: "true", sortOrder: 0 },
    ],
  );

  // Enrich inbox items on ingestion — wakes on the framework's
  // `inbox.item_created` event (emitted by the forward-sync ticker and
  // any other ingestion path) and runs CRM lead-resolution + activity
  // logging via crm.inbox.enrich. This is how framework-ingested Gmail
  // items get CRM enrichment without the CRM running its own poller.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Enrich inbox items on ingestion",
    [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "inbox.item_created" } },
      {
        id: "enrich",
        name: "enrich",
        kind: "tool",
        type: "tool",
        tool: "crm.inbox.enrich",
        inputs: { itemId: "{{trigger.itemId}}" },
        config: {},
      },
    ],
    [{ id: "e1", sourceBlockId: "trigger", targetBlockId: "enrich", sourceHandle: null, sortOrder: 0 }],
  );

  // Activate sync routines on Google connect — rewritten to use the
  // `crm.routines.activate_sync` tool (the v2 engine has no
  // `update-row` block kind). The condition still gates on the
  // connector kind so non-Google connects don't accidentally
  // un-pause our sync routines.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Activate sync routines on Google connect",
    [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "connector.connected" } },
      {
        id: "guard",
        name: "guard",
        kind: "condition",
        type: "condition",
        config: { field: "{{trigger.kind}}", operator: "equals", value: "google" },
      },
      {
        id: "activate",
        name: "activate",
        kind: "tool",
        type: "tool",
        tool: "crm.routines.activate_sync",
        inputs: {},
        config: {},
      },
    ],
    [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "guard", targetBlockId: "activate", sourceHandle: "true", sortOrder: 0 },
    ],
  );

  // "Prep upcoming meetings" is no longer a separate workflow — the
  // Calendar Check tool now seeds the prep tasks inline (one tool
  // call per cron tick is simpler than chaining for_each + create-
  // task + wake-agent, and the v2 engine doesn't support those
  // legacy block kinds anyway).
  void agents.meetingPrepId;

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

  // Phase 3 — ICP-gated lead creation.
  //
  // Wakes on `triage.classified`. When the label is urgent or
  // important, classify the sender against the business profile.
  // If `icpFit` is true, materialize the contact + company (no deal).
  // Noise/fyi short-circuit at the first condition.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Classify and create lead",
    [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "triage.classified" } },
      {
        id: "guard-label",
        name: "guard-label",
        kind: "condition",
        type: "condition",
        config: { field: "{{trigger.label}}", operator: "in", value: ["urgent", "important"] },
      },
      {
        id: "classify",
        name: "classify",
        kind: "tool",
        type: "tool",
        tool: "crm.leads.classify_and_create",
        inputs: { itemId: "{{trigger.itemId}}" },
        config: {},
      },
      {
        id: "guard-fit",
        name: "guard-fit",
        kind: "condition",
        type: "condition",
        config: { field: "{{classify.icpFit}}", operator: "equals", value: true },
      },
      {
        id: "materialize",
        name: "materialize",
        kind: "tool",
        type: "tool",
        tool: "crm.leads.materialize",
        inputs: {
          itemId: "{{trigger.itemId}}",
          classification: {
            icpFit: "{{classify.icpFit}}",
            confidence: "{{classify.confidence}}",
            reason: "{{classify.reason}}",
            suggestedContactName: "{{classify.suggestedContactName}}",
            suggestedCompany: "{{classify.suggestedCompany}}",
          },
        },
        config: {},
      },
    ],
    [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "guard-label", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "guard-label", targetBlockId: "classify", sourceHandle: "true", sortOrder: 0 },
      { id: "e3", sourceBlockId: "classify", targetBlockId: "guard-fit", sourceHandle: null, sortOrder: 0 },
      { id: "e4", sourceBlockId: "guard-fit", targetBlockId: "materialize", sourceHandle: "true", sortOrder: 0 },
    ],
  );

  // Phase 4 — deal creation gated on user reply.
  //
  // Wakes on `inbox.reply_sent` events emitted by crm.inbox.reply.
  // The promote tool itself enforces "contact exists AND no open
  // deal AND non-consumer-domain"; the workflow just plumbs the
  // event through.
  await insertWorkflow(
    db,
    tenantId,
    randomUUID(),
    "Create deal on reply",
    [
      { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { eventType: "inbox.reply_sent" } },
      {
        id: "promote",
        name: "promote",
        kind: "tool",
        type: "tool",
        tool: "crm.contacts.promote_to_deal",
        inputs: {
          contactId: "{{trigger.contactId}}",
          source: "reply_sent",
          itemId: "{{trigger.itemId}}",
        },
        config: {},
      },
    ],
    [{ id: "e1", sourceBlockId: "trigger", targetBlockId: "promote", sourceHandle: null, sortOrder: 0 }],
  );

  return { calCheckWorkflowId };
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

  const calWorkflowId = await lookup("Calendar Check");

  // Both sync routines start ACTIVE in v0.3 — the underlying tools
  // (`crm.inbox.sync` / `crm.calendar.sync_prep`) handle "no Google
  // connector" gracefully with a soft no-op, so we no longer need
  // the connector-gated activation dance. The "Activate sync
  // routines on Google connect" workflow still exists for legacy
  // installs that have paused routines.

  if (calWorkflowId) {
    await db.execute(sql`
      INSERT INTO routines (id, tenant_id, title, workflow_id, cron_expression, status, created_at, updated_at)
      VALUES (${randomUUID()}, ${tenantId}, 'Calendar Check (every 30 min)', ${calWorkflowId},
        '*/30 * * * *', 'active', now(), now())
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
