import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Deal, ListResponse, Forecast } from "@boringos-crm/shared";

export function useDeals(params?: { pipelineId?: string; stageId?: string; search?: string; ownerId?: string }) {
  const query = new URLSearchParams();
  if (params?.pipelineId) query.set("pipelineId", params.pipelineId);
  if (params?.stageId) query.set("stageId", params.stageId);
  if (params?.search) query.set("search", params.search);
  if (params?.ownerId) query.set("ownerId", params.ownerId);
  const qs = query.toString();

  return useQuery({
    queryKey: ["deals", params],
    queryFn: () => api.get<ListResponse<Deal>>(`/deals${qs ? `?${qs}` : ""}`),
  });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: ["deals", id],
    queryFn: () => api.get<{ data: Deal }>(`/deals/${id}`),
    enabled: !!id,
  });
}

export function useForecast(pipelineId: string) {
  return useQuery({
    queryKey: ["forecast", pipelineId],
    queryFn: () => api.get<{ data: Forecast }>(`/pipelines/${pipelineId}/forecast`),
    enabled: !!pipelineId,
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Deal>) => api.post<{ data: Deal }>("/deals", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Deal> & { id: string }) =>
      api.put<{ data: Deal }>(`/deals/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ data: Deal }>(`/deals/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}
