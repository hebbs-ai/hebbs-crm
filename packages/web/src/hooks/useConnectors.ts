import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Connector {
  kind: string;
  name: string;
  description: string;
  hasOAuth: boolean;
  connected: boolean;
  status: string;
  lastSyncAt: string | null;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function connectorFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/connectors${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useConnectorStatus() {
  return useQuery({
    queryKey: ["connectors", "status"],
    queryFn: () => connectorFetch<{ connectors: Connector[]; tenantId: string }>("/status"),
  });
}

export function useDisconnectConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: string) =>
      connectorFetch<{ ok: boolean }>(`/disconnect/${kind}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors", "status"] }),
  });
}
