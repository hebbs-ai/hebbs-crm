import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// --- Types ---

interface CopilotSession {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface RawCopilotMessage {
  id: string;
  body: string;
  role: "user" | "assistant";
  agentId?: string;
  createdAt: string;
}

interface CopilotSessionResponse {
  session: CopilotSession;
  messages: RawCopilotMessage[];
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
    queryFn: async () => {
      const raw = await copilotFetch<{ sessions: CopilotSession[] }>("/sessions");
      return { data: raw.sessions };
    },
  });
}

export function useCopilotSession(id: string | undefined) {
  return useQuery({
    queryKey: ["copilot", "sessions", id],
    queryFn: async () => {
      const raw = await copilotFetch<CopilotSessionResponse>(`/sessions/${id}`);
      return {
        data: {
          ...raw.session,
          messages: raw.messages.map((m): CopilotMessage => ({
            id: m.id,
            role: m.role,
            content: m.body,
            createdAt: m.createdAt,
          })),
        },
      };
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const session = query.state.data?.data;
      if (!session?.messages?.length) return false;
      const lastMessage = session.messages[session.messages.length - 1];
      return lastMessage.role === "user" ? 3000 : false;
    },
  });
}

export function useCreateCopilotSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data?: { title?: string }) => {
      const raw = await copilotFetch<{ id: string; title: string }>("/sessions", {
        method: "POST",
        body: JSON.stringify(data ?? {}),
      });
      return { data: raw };
    },
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
