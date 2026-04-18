import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// --- Types ---

interface Task {
  id: string;
  title: string;
  description?: string;
  priority?: string;
  status: string;
  assigneeUserId?: string;
  assigneeAgentId?: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  authorId: string;
  createdAt: string;
}

interface WorkProduct {
  id: string;
  taskId: string;
  [key: string]: unknown;
}

interface TaskRun {
  id: string;
  agentId: string;
  agentName: string | null;
  status: string;
  model: string | null;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  runCount: number;
  models: string[];
}

interface TaskDetail extends Task {
  comments: TaskComment[];
  workProducts: WorkProduct[];
  runs: TaskRun[];
  costSummary: CostSummary;
}

interface TaskFilters {
  status?: string;
  assigneeUserId?: string;
  assigneeAgentId?: string;
}

interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  assigneeUserId?: string;
  assigneeAgentId?: string;
  parentId?: string;
}

interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeUserId?: string;
  assigneeAgentId?: string;
}

// --- Helpers ---

function frameworkHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function taskFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/tasks${path}`, {
    headers: frameworkHeaders(),
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// --- Hooks ---

export function useTasks(filters?: TaskFilters) {
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.assigneeUserId)
        params.set("assigneeUserId", filters.assigneeUserId);
      if (filters?.assigneeAgentId)
        params.set("assigneeAgentId", filters.assigneeAgentId);
      const qs = params.toString();
      return taskFetch<{ tasks: Task[] }>(qs ? `?${qs}` : "").then((r) => ({ data: r.tasks }));
    },
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => taskFetch<{ task: Task; comments: TaskComment[]; workProducts: WorkProduct[] }>(`/${id}`).then((r) => ({
      data: { ...r.task, comments: r.comments ?? [], workProducts: r.workProducts ?? [], runs: [], costSummary: { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, runCount: 0, models: [] } } as TaskDetail,
    })),
    enabled: !!id,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTaskInput) =>
      taskFetch<{ data: Task }>("", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: UpdateTaskInput) =>
      taskFetch<{ data: Task }>(`/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["tasks", variables.id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function usePostComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: string }) =>
      taskFetch<{ data: TaskComment }>(`/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["tasks", variables.taskId] });
    },
  });
}

interface AssignInput {
  taskId: string;
  agentId: string;
  wake?: boolean;
}

export function useAssignTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, agentId, wake }: AssignInput) =>
      taskFetch<Record<string, unknown>>(`/${taskId}/assign`, {
        method: "POST",
        body: JSON.stringify({ agentId, wake: wake ?? false }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["tasks", variables.taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

interface HandoffInput {
  taskId: string;
  toAgentId: string;
  message?: string;
  wake?: boolean;
}

export function useHandoffTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, toAgentId, message, wake }: HandoffInput) =>
      taskFetch<{ subtaskId?: string; error?: string }>(`/${taskId}/handoff`, {
        method: "POST",
        body: JSON.stringify({ toAgentId, message, wake: wake ?? true }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks", vars.taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      taskFetch<{ ok: boolean }>(`/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}
