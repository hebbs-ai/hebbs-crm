import { useRef } from "react";
import { useMemoryConfig, useEntityFiles, useUploadFile, useDeleteFile } from "../hooks/useMemory";
import { Badge } from "./ui/Badge";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface EntityDocumentsProps {
  entityType: string;
  entityId: string;
}

export function EntityDocuments({ entityType, entityId }: EntityDocumentsProps) {
  const { data: config } = useMemoryConfig();
  const { data: filesData } = useEntityFiles(entityType, entityId);
  const upload = useUploadFile();
  const deleteFile = useDeleteFile();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const configured = config?.configured ?? false;
  const files = filesData?.files ?? [];

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await upload.mutateAsync({ file, entityType, entityId });
    } catch {
      // error available via upload.error
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete "${name}"? This cannot be undone.`)) {
      await deleteFile.mutateAsync(id);
    }
  };

  if (!configured) {
    return (
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
          Documents
        </h2>
        <p className="text-sm text-text-tertiary py-3">
          Configure memory in Settings to enable documents
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          Documents
        </h2>
        <button
          onClick={handleUploadClick}
          disabled={upload.isPending}
          className="text-xs text-accent hover:text-accent-hover transition-colors font-medium"
        >
          {upload.isPending ? "Uploading..." : "+ Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {upload.isError && (
        <div className="mb-2 rounded-md bg-surface-red px-3 py-1.5 text-xs text-text-red">
          {upload.error?.message ?? "Upload failed"}
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-text-tertiary py-3">No documents yet</p>
      ) : (
        <div className="rounded-lg border border-border">
          {files.map((file, i) => (
            <div
              key={file.id}
              className={`flex items-center justify-between px-4 py-2.5 hover:bg-bg-secondary transition-colors ${
                i < files.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-sm font-medium text-text-primary truncate">
                  {file.name}
                </span>
                <span className="text-xs text-text-tertiary shrink-0">
                  {formatFileSize(file.size)}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <div className="flex items-center gap-1.5">
                  <Badge
                    color={
                      file.status === "indexed"
                        ? "green"
                        : file.status === "pending" || file.status === "indexing"
                          ? "yellow"
                          : "gray"
                    }
                  >
                    {file.status}
                  </Badge>
                  {(file.status === "pending" || file.status === "indexing") && (
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                  )}
                </div>
                <span className="text-xs text-text-tertiary">
                  {formatDate(file.createdAt)}
                </span>
                <button
                  onClick={() => handleDelete(file.id, file.name)}
                  disabled={deleteFile.isPending}
                  className="text-xs text-text-tertiary hover:text-text-red transition-colors disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
