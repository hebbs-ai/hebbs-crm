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

export function useAllInboxItems() {
  // Fetch both unread + read (not archived) for "Needs Attention"
  // And archived for "Auto-Handled"
  const unread = useInbox("unread");
  const read = useInbox("read");
  const archived = useInbox("archived");

  const active = [...(unread.data?.items ?? []), ...(read.data?.items ?? [])];
  const handled = archived.data?.items ?? [];
  const isLoading = unread.isLoading || read.isLoading || archived.isLoading;

  return { active, handled, isLoading };
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

// Thread messages for the email viewer modal

export interface ThreadMessage {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  bodyPlain: string | null;
  bodyHtml: string | null;
  snippet: string | null;
}

async function crmFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/crm/inbox${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useReplyToEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      crmFetch<{ ok: boolean; messageId?: string }>(`/${id}/reply`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inbox", vars.id, "thread"] });
    },
  });
}

export function useArchiveInGmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      crmFetch<{ ok: boolean }>(`/${id}/archive-gmail`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useSyncInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => crmFetch<{ created: number; threads: number }>("/sync", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useInboxThread(itemId: string | null) {
  return useQuery({
    queryKey: ["inbox", itemId, "thread"],
    queryFn: () => crmFetch<{ threadMessages: ThreadMessage[] }>(`/${itemId}/thread`),
    enabled: !!itemId,
    staleTime: 5 * 60 * 1000, // cache for 5 min
  });
}
