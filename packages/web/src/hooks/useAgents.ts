import { useQuery } from "@tanstack/react-query";

export interface Agent {
  id: string;
  name: string;
  title?: string;
  role: string;
  status: string;
}

function adminHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

const SYSTEM_ROLES = new Set([
  "email-triage",
  "enrichment",
  "enrichment-contact",
  "enrichment-company",
  "deal-analyst",
  "follow-up-writer",
  "meeting-prep",
]);

export function isUserFacingAgent(a: Agent): boolean {
  return !SYSTEM_ROLES.has(a.role);
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/admin/agents", { headers: adminHeaders() });
      if (!res.ok) throw new Error(`Failed to load agents: ${res.status}`);
      const body = (await res.json()) as { agents: Agent[] };
      return body.agents;
    },
  });
}
