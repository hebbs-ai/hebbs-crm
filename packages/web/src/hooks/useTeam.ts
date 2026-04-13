import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface TeamUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  code: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

// Framework auth routes — not CRM routes, so we call /api/auth/* directly
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function authFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/auth${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useTeamUsers() {
  return useQuery({
    queryKey: ["team", "users"],
    queryFn: () => authFetch<{ data: TeamUser[] }>("/team"),
  });
}

export function useInvitations() {
  return useQuery({
    queryKey: ["team", "invitations"],
    queryFn: () => authFetch<{ data: Invitation[] }>("/invitations"),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role?: string }) =>
      authFetch<{ code: string; inviteLink: string }>("/invite", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "invitations"] }),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      authFetch<{ ok: boolean }>(`/team/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "users"] }),
  });
}

export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      authFetch<{ ok: boolean }>(`/team/${userId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "users"] }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authFetch<{ ok: boolean }>(`/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "invitations"] }),
  });
}
