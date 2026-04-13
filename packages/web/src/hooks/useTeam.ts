import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

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

export function useTeamUsers() {
  return useQuery({
    queryKey: ["team", "users"],
    queryFn: () => api.get<{ data: TeamUser[] }>("/team/users"),
  });
}

export function useInvitations() {
  return useQuery({
    queryKey: ["team", "invitations"],
    queryFn: () => api.get<{ data: Invitation[] }>("/team/invitations"),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role?: string }) =>
      api.post<{ data: Invitation; inviteLink: string }>("/team/invitations", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "invitations"] }),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch<{ ok: boolean }>(`/team/users/${userId}/role`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "users"] }),
  });
}

export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<{ ok: boolean }>(`/team/users/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "users"] }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/team/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", "invitations"] }),
  });
}
