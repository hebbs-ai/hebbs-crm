import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// --- Types ---

interface EntityRef {
  entityType: string;
  entityId: string;
  refType: string;
  refId: string;
}

interface LinkEntityInput {
  entityType: string;
  entityId: string;
  refType: string;
  refId: string;
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

async function entityFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/entities${path}`, {
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

export function useEntityRefs(type: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["entityRefs", type, id],
    queryFn: () => entityFetch<{ data: EntityRef[] }>(`/${type}/${id}/refs`),
    enabled: !!type && !!id,
  });
}

export function useLinkEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: LinkEntityInput) =>
      entityFetch<{ data: EntityRef }>("/link", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ["entityRefs", variables.entityType, variables.entityId],
      });
      qc.invalidateQueries({
        queryKey: ["entityRefs", variables.refType, variables.refId],
      });
    },
  });
}
