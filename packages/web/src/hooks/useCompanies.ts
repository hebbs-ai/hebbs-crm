import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Company, ListResponse } from "@boringos-crm/shared";

export function useCompanies(params?: { search?: string; ownerId?: string }) {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.ownerId) query.set("ownerId", params.ownerId);
  const qs = query.toString();

  return useQuery({
    queryKey: ["companies", params],
    queryFn: () => api.get<ListResponse<Company>>(`/companies${qs ? `?${qs}` : ""}`),
  });
}

export function useCompany(id: string) {
  return useQuery({
    queryKey: ["companies", id],
    queryFn: () => api.get<{ data: Company }>(`/companies/${id}`),
    enabled: !!id,
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Company>) => api.post<{ data: Company }>("/companies", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Company> & { id: string }) =>
      api.put<{ data: Company }>(`/companies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ data: Company }>(`/companies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
  });
}
