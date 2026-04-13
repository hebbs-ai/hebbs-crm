import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Pipeline, PipelineStage } from "@boringos-crm/shared";

export function usePipelines() {
  return useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ data: Pipeline[] }>("/pipelines"),
  });
}

export function usePipeline(id: string) {
  return useQuery({
    queryKey: ["pipelines", id],
    queryFn: () => api.get<{ data: Pipeline & { stages: PipelineStage[] } }>(`/pipelines/${id}`),
    enabled: !!id,
  });
}

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; stages?: Partial<PipelineStage>[] }) =>
      api.post<{ data: Pipeline }>("/pipelines", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useUpdatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; isDefault?: boolean }) =>
      api.put<{ data: Pipeline }>(`/pipelines/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}
