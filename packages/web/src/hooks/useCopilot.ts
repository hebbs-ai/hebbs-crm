import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// --- Types ---

interface CopilotSession {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

interface CopilotMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface CopilotSessionDetail extends CopilotSession {
  messages: CopilotMessage[];
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

async function copilotFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/copilot${path}`, {
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

export function useCopilotSessions() {
  return useQuery({
    queryKey: ["copilot", "sessions"],
    queryFn: () => copilotFetch<{ data: CopilotSession[] }>("/sessions"),
  });
}

export function useCopilotSession(id: string | undefined) {
  return useQuery({
    queryKey: ["copilot", "sessions", id],
    queryFn: () =>
      copilotFetch<{ data: CopilotSessionDetail }>(`/sessions/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const session = query.state.data?.data;
      if (!session?.messages?.length) return false;
      const lastMessage = session.messages[session.messages.length - 1];
      // Poll while waiting for agent reply (last message is from user)
      return lastMessage.role === "user" ? 3000 : false;
    },
  });
}

export function useCreateCopilotSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data?: { title?: string }) =>
      copilotFetch<{ data: CopilotSession }>("/sessions", {
        method: "POST",
        body: JSON.stringify(data ?? {}),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["copilot", "sessions"] }),
  });
}

export function useSendCopilotMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      message,
    }: {
      sessionId: string;
      message: string;
    }) =>
      copilotFetch<{ data: CopilotMessage }>(`/sessions/${sessionId}/message`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ["copilot", "sessions", variables.sessionId],
      });
    },
  });
}

export function useArchiveCopilotSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      copilotFetch<{ ok: boolean }>(`/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["copilot", "sessions"] }),
  });
}
