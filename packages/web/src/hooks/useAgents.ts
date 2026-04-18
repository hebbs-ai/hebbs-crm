import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Agent {
  id: string;
  name: string;
  title?: string | null;
  role: string;
  status: string;
  reportsTo?: string | null;
  instructions?: string | null;
  skills?: string[] | null;
  runtimeId?: string | null;
  budgetMonthlyCents?: number;
  spentMonthlyCents?: number;
}

export interface OrgNode extends Agent {
  reports: OrgNode[];
}

function adminHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function adminFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, { headers: adminHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
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
      const body = await adminFetch<{ agents: Agent[] }>("/agents");
      return body.agents;
    },
  });
}

export function useOrgTree() {
  return useQuery({
    queryKey: ["agents", "org-tree"],
    queryFn: async () => {
      const body = await adminFetch<{ tree: OrgNode[] }>("/agents/org-tree");
      return body.tree;
    },
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: ["agents", id],
    queryFn: () => adminFetch<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Agent> & { id: string }) =>
      adminFetch<Agent>(`/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", vars.id] });
    },
  });
}

export interface Runtime {
  id: string;
  name: string;
  type?: string | null;
  model?: string | null;
  isDefault?: boolean;
}

export function useRuntimes() {
  return useQuery({
    queryKey: ["runtimes"],
    queryFn: async () => {
      const body = await adminFetch<{ runtimes: Runtime[] }>("/runtimes");
      return body.runtimes;
    },
  });
}

export function useTenantSettings() {
  return useQuery({
    queryKey: ["tenant-settings"],
    queryFn: async () => {
      const body = await adminFetch<{ settings: Record<string, string | null> }>("/settings");
      return body.settings;
    },
  });
}

export function useUpdateTenantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, string | null>) =>
      adminFetch<{ settings: Record<string, string | null> }>("/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-settings"] });
    },
  });
}

export interface CreateAgentInput {
  name: string;
  role?: string;
  title?: string;
  reportsTo?: string | null;
  runtimeId?: string | null;
  instructions?: string;
  skills?: string[];
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentInput) =>
      adminFetch<Agent>("/agents", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, set }: { id: string; set: string[] }) =>
      adminFetch<{ agentId: string; skills: string[] }>(`/agents/${id}/skills`, {
        method: "PATCH",
        body: JSON.stringify({ set }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", vars.id] });
    },
  });
}
