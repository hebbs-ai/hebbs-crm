import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ActionItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  originKind: "agent_action" | "human_todo" | "agent_blocked" | string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  parentId: string | null;
  proposedParams: Record<string, unknown> | null;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function call<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/crm/actions${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface ActionListOpts {
  status?: string;
  kind?: string;
  entityType?: "contact" | "deal" | "company";
  entityId?: string;
}

function toParams(opts: ActionListOpts = {}): string {
  const p = new URLSearchParams();
  if (opts.status) p.set("status", opts.status);
  if (opts.kind) p.set("kind", opts.kind);
  if (opts.entityType) p.set("entityType", opts.entityType);
  if (opts.entityId) p.set("entityId", opts.entityId);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export function useActions(opts: ActionListOpts = {}) {
  const qs = toParams(opts);
  return useQuery({
    queryKey: ["actions", "list", opts.status ?? "todo", opts.kind ?? "all", opts.entityType ?? "", opts.entityId ?? ""],
    queryFn: () => call<{ data: ActionItem[] }>(qs),
    refetchInterval: 15000, // polling — SSE deferred (framework SSE uses admin key)
  });
}

export function useActionCount(opts: { entityType?: ActionListOpts["entityType"]; entityId?: string } = {}) {
  const qs = toParams(opts);
  return useQuery({
    queryKey: ["actions", "count", opts.entityType ?? "", opts.entityId ?? ""],
    queryFn: () => call<{ pending: number }>(`/count${qs}`),
    refetchInterval: 15000,
  });
}

export function useDismissAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call<{ ok: true }>(`/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useCompleteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call<{ ok: true }>(`/${id}/complete`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useExecuteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params?: Record<string, unknown> }) =>
      call<{ ok: boolean; detail?: unknown; error?: string }>(`/${id}/execute`, {
        method: "POST",
        body: JSON.stringify({ params: params ?? {} }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export interface ActionComment {
  id: string;
  body: string;
  authorUserId: string | null;
  authorAgentId: string | null;
  createdAt: string;
}

export function useActionComments(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["actions", id, "comments"],
    queryFn: () => call<{ data: ActionComment[] }>(`/${id}/comments`),
    enabled,
  });
}

export function usePostActionComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      call<{ ok: true }>(`/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions", id, "comments"] });
      qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useParentTask(parentId: string | null) {
  return useQuery({
    queryKey: ["actions", "parent", parentId],
    queryFn: async () => {
      // Use the framework admin tasks endpoint to fetch parent context.
      // Falls back gracefully if parent isn't accessible.
      const token = localStorage.getItem("token");
      const tenantId = localStorage.getItem("tenantId");
      const res = await fetch(`/api/admin/tasks/${parentId}`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
        },
      });
      if (!res.ok) return null;
      const body = await res.json() as { task?: { id: string; title: string } };
      return body.task ?? null;
    },
    enabled: !!parentId,
  });
}
