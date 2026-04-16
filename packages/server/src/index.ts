import { BoringOS } from "@boringos/core";
import { google } from "@boringos/connector-google";
import { slack } from "@boringos/connector-slack";
import { createCrmRoutes } from "./routes/index.js";
import { createCrmContext } from "./context.js";
import { provisionCrmTenant } from "./tenant.js";
import { crmSchemaProvider } from "./context-providers/crm-schema.js";
import { createCrmUserContextProvider } from "./context-providers/crm-user-context.js";

const app = new BoringOS({});

// Register connectors
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  app.connector(google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }));
}
if (process.env.SLACK_SIGNING_SECRET) {
  app.connector(slack({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  }));
}

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

  CREATE TABLE IF NOT EXISTS crm_knowledge_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    remote_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_knowledge_files_tenant_idx ON crm_knowledge_files(tenant_id);
`);

// CRM context providers — teach copilot about CRM data
// Registered before listen() so they're in the context pipeline
let dbRef: unknown = null;
app.contextProvider(crmSchemaProvider);
app.contextProvider(createCrmUserContextProvider(() => dbRef));

// When a new tenant signs up, create the default sales pipeline + agents
app.onTenantCreated(async (db, tenantId) => {
  await provisionCrmTenant(db as any, tenantId);
});

// Helper: find agent by role for a tenant, create task, wake it
let agentEngineRef: any = null;
async function wakeAgentByRole(
  role: string, tenantId: string,
  taskTitle: string, taskDescription: string, taskOriginKind: string,
  payload: Record<string, unknown>,
) {
  if (!agentEngineRef || !dbRef) return;
  const db = dbRef as any;
  const { sql } = await import("drizzle-orm");

  const agentRows = await db.execute(sql`
    SELECT id FROM agents WHERE tenant_id = ${tenantId} AND role = ${role} LIMIT 1
  `);
  const agentId = (agentRows as any)[0]?.id;
  if (!agentId) return;

  const { randomUUID } = await import("node:crypto");
  const taskId = randomUUID();
  await db.execute(sql`
    INSERT INTO tasks (id, tenant_id, title, description, status, priority, assignee_agent_id, origin_kind, created_at, updated_at)
    VALUES (${taskId}, ${tenantId}, ${taskTitle}, ${taskDescription}, 'todo', 'medium', ${agentId}, ${taskOriginKind}, now(), now())
  `);

  const outcome = await agentEngineRef.wake({
    agentId, tenantId, reason: "connector_event", taskId, payload,
  });
  if (outcome.kind === "created") {
    await agentEngineRef.enqueue(outcome.wakeupRequestId);
  }
}

// Event-driven: wake Email Triage agent when new inbox items arrive
// No per-item tasks — agent queries all unread inbox items directly
app.onEvent("inbox.item_created", async (event) => {
  if (!agentEngineRef || !dbRef) return;
  const db = dbRef as any;
  const { sql } = await import("drizzle-orm");

  // Find triage agent
  const agentRows = await db.execute(sql`
    SELECT id FROM agents WHERE tenant_id = ${event.tenantId} AND role = 'email-triage' LIMIT 1
  `);
  const agentId = (agentRows as any)[0]?.id;
  if (!agentId) return;

  // Just wake — no task needed. Agent queries inbox directly.
  // Coalescing handles multiple events: only one wake per batch.
  const outcome = await agentEngineRef.wake({
    agentId,
    tenantId: event.tenantId,
    reason: "connector_event",
  });
  if (outcome.kind === "created") {
    await agentEngineRef.enqueue(outcome.wakeupRequestId);
  }
});

// Event-driven: activate sync routines when Google is connected
app.onEvent("connector.connected", async (event) => {
  if (event.data.kind !== "google") return;
  const db = dbRef as any;
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  // Unpause Google-dependent routines (email sync + calendar check)
  await db.execute(sql`
    UPDATE routines SET status = 'active'
    WHERE tenant_id = ${event.tenantId}
      AND (title LIKE '%Sync%' OR title LIKE '%Calendar Check%')
      AND status = 'paused'
  `).catch(() => {});
});

// Event-driven: dedup calendar events and wake Meeting Prep for new meetings
app.onEvent("calendar.upcoming_events", async (event) => {
  if (!agentEngineRef || !dbRef) return;
  const db = dbRef as any;
  const { sql } = await import("drizzle-orm");

  let events: any[] = [];
  try {
    const raw = event.data.events;
    events = typeof raw === "string" ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
  } catch { return; }

  if (events.length === 0) return;

  // Filter to events within the next 60 minutes
  const now = Date.now();
  const oneHour = now + 60 * 60 * 1000;
  const upcoming = events.filter((e: any) => {
    const start = new Date(e.start?.dateTime ?? e.start?.date ?? "").getTime();
    return start > now && start < oneHour;
  });

  if (upcoming.length === 0) return;

  // Check which events already have prep tasks (dedup by event ID)
  const eventIds = upcoming.map((e: any) => e.id).filter(Boolean);
  const existingTasks = await db.execute(sql`
    SELECT description FROM tasks
    WHERE tenant_id = ${event.tenantId}
      AND origin_kind = 'agent-meeting-prep'
      AND status IN ('todo', 'in_progress', 'done')
  `);
  const preppedIds = new Set<string>();
  for (const t of existingTasks as any[]) {
    const desc = t.description ?? "";
    for (const eid of eventIds) {
      if (desc.includes(eid)) preppedIds.add(eid);
    }
  }

  // Create tasks only for unprepped meetings
  const newMeetings = upcoming.filter((e: any) => e.id && !preppedIds.has(e.id));
  if (newMeetings.length === 0) return;

  for (const meeting of newMeetings) {
    const summary = meeting.summary ?? "Meeting";
    const start = meeting.start?.dateTime ?? meeting.start?.date ?? "";
    const attendees = (meeting.attendees ?? []).map((a: any) => a.email).join(", ");

    await wakeAgentByRole(
      "meeting-prep", event.tenantId,
      `Meeting prep: ${summary}`,
      `Prepare for meeting: ${summary}\nEvent ID: ${meeting.id}\nStart: ${start}\nAttendees: ${attendees}\nLocation: ${meeting.location ?? "N/A"}\nDescription: ${meeting.description ?? "N/A"}`,
      "agent-meeting-prep",
      { eventId: meeting.id, summary, start, attendees },
    );
  }
});

// Event-driven: wake Enrichment agent when new contacts/companies are created
app.onEvent("entity.created", async (event) => {
  const { entityType, entityId } = event.data as { entityType: string; entityId: string };
  if (entityType !== "crm_contact" && entityType !== "crm_company") return;
  const label = entityType === "crm_contact" ? "contact" : "company";
  await wakeAgentByRole(
    "enrichment", event.tenantId,
    `Enrich ${label}`,
    `Research and enrich ${label}: ${entityId}\nEntity type: ${entityType}\nEntity ID: ${entityId}`,
    "agent-enrichment",
    event.data as Record<string, unknown>,
  );
});

// CRM data routes
app.beforeStart(async (ctx) => {
  dbRef = ctx.db;
  agentEngineRef = ctx.agentEngine;
  const crmCtx = createCrmContext(ctx.db, (type, tenantId, data) => {
    ctx.eventBus?.emit({
      connectorKind: "crm",
      type,
      tenantId,
      data,
      timestamp: new Date(),
    }).catch(() => {});
  });
  app.route("/api/crm", createCrmRoutes(crmCtx));
});

const server = await app.listen(3001);

console.log("BoringOS CRM server running on http://localhost:3001");
