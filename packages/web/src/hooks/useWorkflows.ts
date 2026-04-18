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
  return useQuery({
    queryKey: ["workflow-runs", runId],
    queryFn: () => admin<{ run: WorkflowRun; blocks: BlockRun[] }>(`/workflow-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) => {
      // Poll more aggressively while the run is still in flight
      const run = query.state.data?.run;
      if (run && (run.status === "running" || run.status === "queued")) return 2000;
      return false;
    },
  });
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
