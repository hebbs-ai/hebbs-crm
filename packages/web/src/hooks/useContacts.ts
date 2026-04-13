import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Contact, ListResponse } from "@boringos-crm/shared";

export function useContacts(params?: { search?: string; companyId?: string; ownerId?: string }) {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.companyId) query.set("companyId", params.companyId);
  if (params?.ownerId) query.set("ownerId", params.ownerId);
  const qs = query.toString();

  return useQuery({
    queryKey: ["contacts", params],
    queryFn: () => api.get<ListResponse<Contact>>(`/contacts${qs ? `?${qs}` : ""}`),
  });
}

export function useContact(id: string) {
  return useQuery({
    queryKey: ["contacts", id],
    queryFn: () => api.get<{ data: Contact }>(`/contacts/${id}`),
    enabled: !!id,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Contact>) => api.post<{ data: Contact }>("/contacts", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Contact> & { id: string }) =>
      api.put<{ data: Contact }>(`/contacts/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ data: Contact }>(`/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}
