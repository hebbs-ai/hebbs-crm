import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowBlock {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  sourceHandle: string | null;
  sortOrder: number;
}

export type WorkflowStatus = "draft" | "active" | "paused" | "archived";
export type WorkflowType = "user" | "system";

export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  type: WorkflowType;
  status: WorkflowStatus;
  governingAgentId: string | null;
  blocks: WorkflowBlock[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRunStatus = "queued" | "running" | "waiting_for_human" | "completed" | "failed" | "cancelled";
export type BlockRunStatus = "pending" | "running" | "completed" | "skipped" | "failed" | "waiting";

export interface WorkflowRun {
  id: string;
  tenantId: string;
  workflowId: string;
  triggerType: string;
  triggerPayload: Record<string, unknown> | null;
  status: WorkflowRunStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlockRun {
  id: string;
  workflowRunId: string;
  tenantId: string;
  blockId: string;
  blockName: string;
  blockType: string;
  status: BlockRunStatus;
  resolvedConfig: Record<string, unknown> | null;
  inputContext: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  selectedHandle: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── API helper ─────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function admin<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Queries ────────────────────────────────────────────────────────────────

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: () => admin<{ workflows: Workflow[] }>("/workflows"),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ["workflows", id],
    queryFn: () => admin<Workflow>(`/workflows/${id}`),
    enabled: !!id,
  });
}

export function useWorkflowRuns(workflowId: string | undefined) {
  return useQuery({
    queryKey: ["workflows", workflowId, "runs"],
    queryFn: () => admin<{ runs: WorkflowRun[] }>(`/workflows/${workflowId}/runs?limit=100`),
    enabled: !!workflowId,
    refetchInterval: 15000, // poll for live updates while a run is in flight
  });
}

export function useWorkflowRun(runId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["workflow-runs", runId],
    queryFn: () => admin<{ run: WorkflowRun; blocks: BlockRun[] }>(`/workflow-runs/${runId}`),
    enabled: !!runId,
    // SSE supplies pushes below. We keep a backup poll (slow) for any
    // dropped connections / dev-server hot-reloads where SSE reconnects
    // haven't kicked in yet.
    refetchInterval: (q) => {
      const run = q.state.data?.run;
      if (run && (run.status === "running" || run.status === "queued")) return 10000;
      return false;
    },
  });

  // Live updates via server-sent events. Every workflow lifecycle event
  // for this run triggers a cache invalidate → React Query refetches the
  // run + blocks. Keeps the UI in sync with the engine without having
  // to reconstruct partial state here.
  useEffect(() => {
    if (!runId) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const url = `/api/admin/workflow-runs/${runId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    const onEvent = () => {
      qc.invalidateQueries({ queryKey: ["workflow-runs", runId] });
    };
    // Listen for every workflow:* event. Using addEventListener for each
    // known type because EventSource routes by `event:` name.
    const types = [
      "workflow:run_started",
      "workflow:run_completed",
      "workflow:run_failed",
      "workflow:run_paused",
      "workflow:block_started",
      "workflow:block_completed",
      "workflow:block_failed",
      "workflow:block_waiting",
      "workflow:block_skipped",
    ];
    for (const t of types) es.addEventListener(t, onEvent);
    // Don't need to handle errors aggressively — EventSource auto-reconnects,
    // and the 10s poll above covers any gap.
    return () => {
      for (const t of types) es.removeEventListener(t, onEvent);
      es.close();
    };
  }, [runId, qc]);

  return query;
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useUpdateWorkflowStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkflowStatus }) =>
      admin<Workflow>(`/workflows/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflows", vars.id] });
    },
  });
}

export function useExecuteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: Record<string, unknown> }) =>
      admin<{ runId: string; status: string; error?: string }>(`/workflows/${id}/execute`, {
        method: "POST",
        body: JSON.stringify({ payload: payload ?? {} }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workflows", vars.id, "runs"] });
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Workflow, "name" | "blocks" | "edges" | "status" | "governingAgentId">> }) =>
      admin<Workflow>(`/workflows/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflows", vars.id] });
    },
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; blocks?: WorkflowBlock[]; edges?: WorkflowEdge[] }) =>
      admin<Workflow>("/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          blocks: input.blocks ?? [
            { id: "trigger", name: "trigger", type: "trigger", config: {} },
          ],
          edges: input.edges ?? [],
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

/**
 * Replay a past run. Re-executes the workflow (at its *current* definition)
 * using the original run's triggerPayload. Useful for reproducing scenarios
 * while debugging — fix a block, replay the failing run, check if it passes.
 */
export function useReplayRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      admin<{ runId: string; status: string; error?: string; replayedFromRunId: string }>(
        `/workflow-runs/${runId}/replay`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      // Invalidate any run list that might include the new run.
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow-runs", data.runId] });
    },
  });
}

/** Lookup agents for use in WakeAgent config dropdown */
export function useAgentsForWorkflow() {
  return useQuery({
    queryKey: ["workflow-editor", "agents"],
    queryFn: () => admin<{ agents: Array<{ id: string; name: string; role: string }> }>("/agents"),
    staleTime: 60_000,
  });
}
