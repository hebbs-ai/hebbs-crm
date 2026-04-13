import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Activity, ListResponse, ActivityType } from "@boringos-crm/shared";

export function useActivities(params?: {
  contactId?: string;
  dealId?: string;
  companyId?: string;
  type?: ActivityType;
}) {
  const query = new URLSearchParams();
  if (params?.contactId) query.set("contactId", params.contactId);
  if (params?.dealId) query.set("dealId", params.dealId);
  if (params?.companyId) query.set("companyId", params.companyId);
  if (params?.type) query.set("type", params.type);
  const qs = query.toString();

  return useQuery({
    queryKey: ["activities", params],
    queryFn: () => api.get<ListResponse<Activity>>(`/activities${qs ? `?${qs}` : ""}`),
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Activity>) => api.post<{ data: Activity }>("/activities", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ data: Activity }>(`/activities/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}
