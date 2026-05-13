// CRM action-queue React hooks. All wire calls go through the v2 tool
// dispatcher (`/api/tools/crm.actions.<verb>`) — the old REST routes
// (`/api/crm/actions/...`) were removed when the CRM became a module.
//
// Auth is read from the shell's `boringos.token` / `boringos.tenantId`
// localStorage keys via the shared `api` client.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, tool } from "../lib/api";

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
    queryKey: [
      "actions",
      "list",
      opts.status ?? "todo",
      opts.kind ?? "all",
      opts.entityType ?? "",
      opts.entityId ?? "",
    ],
    queryFn: () => api.get<{ data: ActionItem[] }>(`/actions${qs}`),
    refetchInterval: 15000, // polling — SSE deferred (framework SSE uses admin key)
  });
}

export function useActionCount(opts: { entityType?: ActionListOpts["entityType"]; entityId?: string } = {}) {
  const qs = toParams(opts);
  return useQuery({
    queryKey: ["actions", "count", opts.entityType ?? "", opts.entityId ?? ""],
    queryFn: () => api.get<{ pending: number }>(`/actions/count${qs}`),
    refetchInterval: 15000,
  });
}

export function useDismissAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ id: string; status: string }>(`/actions/${id}/dismiss`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useCompleteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ id: string; status: string }>(`/actions/${id}/complete`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useExecuteAction() {
  const qc = useQueryClient();
  return useMutation({
    // `params` here mirrors the v1 shape, but the v2 tool expects them at
    // the top level — pass `params` through directly.
    mutationFn: ({ id, params }: { id: string; params?: Record<string, unknown> }) =>
      tool<{ kind?: string; messageId?: string; activityId?: string }>(
        "crm.actions.execute",
        { id, params: params ?? {} },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      // Activity timeline + dossier listing should refresh too, since
      // execute now writes a `crm__activities` row for reply / meeting /
      // log_activity.
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["dossier"] });
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
    queryFn: () => api.get<{ data: ActionComment[] }>(`/actions/${id}/comments`),
    enabled,
  });
}

export function usePostActionComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post<{ id: string; targetAgentId: string | null }>(
        `/actions/${id}/comments`,
        { body },
      ),
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
      // Parent tasks live in the framework's `tasks` table — fetched via
      // the admin route since there's no CRM-side tool that exposes
      // arbitrary tasks. Auth headers mirror `api.ts`.
      const token =
        localStorage.getItem("boringos.token") ?? localStorage.getItem("token");
      const tenantId =
        localStorage.getItem("boringos.tenantId") ?? localStorage.getItem("tenantId");
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
