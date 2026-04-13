import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface InboxItem {
  id: string;
  source: string;
  sourceId: string;
  subject: string;
  body: string;
  from: string;
  status: string;
  assigneeUserId: string | null;
  metadata: Record<string, unknown>;
  linkedTaskId: string | null;
  createdAt: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function inboxFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/inbox${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useInbox(status?: string) {
  const params = status ? `?status=${status}` : "";
  return useQuery({
    queryKey: ["inbox", status ?? "all"],
    queryFn: () => inboxFetch<{ items: InboxItem[] }>(params),
  });
}

export function useArchiveInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      inboxFetch<{ ok: boolean }>(`/${id}/archive`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useCreateTaskFromInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      inboxFetch<{ ok: boolean; taskId?: string }>(`/${id}/create-task`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}
