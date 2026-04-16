import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

interface MemoryConfig {
  configured: boolean;
  endpoint: string | null;
  hasApiKey: boolean;
}

interface KnowledgeFile {
  id: string;
  name: string;
  size: number;
  status: string;
  createdAt: string;
}

export function useMemoryConfig() {
  return useQuery({
    queryKey: ["memory", "config"],
    queryFn: () => api.get<MemoryConfig>("/memory/config"),
  });
}

export function useSaveMemoryConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { endpoint: string; apiKey: string }) =>
      api.post<{ ok: boolean }>("/memory/config", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory", "config"] });
    },
  });
}

export function useRemoveMemoryConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ ok: boolean }>("/memory/config"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory", "config"] });
      qc.invalidateQueries({ queryKey: ["memory", "files"] });
    },
  });
}

export function useKnowledgeFiles() {
  return useQuery({
    queryKey: ["memory", "files"],
    queryFn: () => api.get<{ files: KnowledgeFile[] }>("/memory/files"),
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const token = localStorage.getItem("token");
      const tenantId = localStorage.getItem("tenantId");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (tenantId) headers["X-Tenant-Id"] = tenantId;

      const res = await fetch("/api/crm/memory/files", {
        method: "POST",
        headers,
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed: ${res.status}`);
      }

      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory", "files"] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/memory/files/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory", "files"] });
    },
  });
}
