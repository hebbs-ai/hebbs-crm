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
  entityType?: string;
  entityId?: string;
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
    refetchInterval: (query) => {
      // Poll every 3s if any files are pending/indexing
      const files = query.state.data?.files ?? [];
      const hasPending = files.some((f) => f.status === "pending" || f.status === "indexing");
      return hasPending ? 3000 : false;
    },
  });
}

export function useFileStatus(fileId: string | undefined) {
  return useQuery({
    queryKey: ["memory", "files", fileId, "status"],
    queryFn: () => api.get<{ path: string; status: string; sections?: number; memories?: number }>(`/memory/files/${fileId}/status`),
    enabled: !!fileId,
  });
}

export function useEntityFiles(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ["memory", "files", entityType, entityId],
    queryFn: () =>
      api.get<{ files: KnowledgeFile[] }>(
        `/memory/files?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
    refetchInterval: (query) => {
      const files = query.state.data?.files ?? [];
      const hasPending = files.some((f) => f.status === "pending" || f.status === "indexing");
      return hasPending ? 3000 : false;
    },
  });
}

interface UploadFileParams {
  file: File;
  entityType?: string;
  entityId?: string;
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, entityType, entityId }: UploadFileParams) => {
      const formData = new FormData();
      formData.append("file", file);
      if (entityType) formData.append("entityType", entityType);
      if (entityId) formData.append("entityId", entityId);

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
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["memory", "files"] });
      if (variables.entityType && variables.entityId) {
        qc.invalidateQueries({
          queryKey: ["memory", "files", variables.entityType, variables.entityId],
        });
      }
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/memory/files/${id}`),
    onSuccess: () => {
      // Invalidate all file queries (global + entity-scoped)
      qc.invalidateQueries({ queryKey: ["memory", "files"] });
    },
  });
}
