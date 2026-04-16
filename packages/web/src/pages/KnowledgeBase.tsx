import { useRef } from "react";
import { Link } from "react-router-dom";
import { useMemoryConfig, useKnowledgeFiles, useUploadFile, useDeleteFile } from "../hooks/useMemory";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " " + d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function KnowledgeBasePage() {
  const { data: config, isLoading: configLoading } = useMemoryConfig();
  const { data: filesData, isLoading: filesLoading } = useKnowledgeFiles();
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
      await upload.mutateAsync(file);
    } catch {
      // error available via upload.error
    }
    // Reset input so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete "${name}"? This cannot be undone.`)) {
      await deleteFile.mutateAsync(id);
    }
  };

  if (configLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
        <p className="text-sm text-text-secondary">Loading...</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
        <PageHeader title="Knowledge Base" />
        <div className="rounded-lg border border-border p-8 text-center">
          <div className="mb-3 text-4xl text-text-tertiary">{"\u2205"}</div>
          <h3 className="text-sm font-medium text-text-primary">Configure memory in Settings first</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Connect your Hebbs instance to start uploading documents.
          </p>
          <Link
            to="/settings/memory"
            className="mt-4 inline-block rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Go to Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Knowledge Base"
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={handleUploadClick}
              disabled={upload.isPending}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {upload.isPending ? "Uploading..." : "+ Upload File"}
            </button>
          </>
        }
      />

      {upload.isError && (
        <div className="mb-4 rounded-md bg-surface-red px-4 py-2 text-sm text-text-red">
          {upload.error?.message ?? "Upload failed"}
        </div>
      )}

      {filesLoading ? (
        <p className="text-sm text-text-secondary">Loading files...</p>
      ) : files.length === 0 ? (
        <EmptyState
          title="No files uploaded yet"
          description="Upload product docs, pricing sheets, and playbooks to enhance your AI assistant."
          action={{ label: "Upload File", onClick: handleUploadClick }}
        />
      ) : (
        <div className="rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_100px_100px_160px_60px] gap-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary border-b border-border">
            <span>Name</span>
            <span>Size</span>
            <span>Status</span>
            <span>Uploaded</span>
            <span></span>
          </div>
          {files.map((file) => (
            <div
              key={file.id}
              className="grid grid-cols-[1fr_100px_100px_160px_60px] gap-4 px-4 py-3 border-b border-border last:border-b-0 items-center hover:bg-bg-secondary transition-colors"
            >
              <div className="text-sm font-medium text-text-primary truncate">{file.name}</div>
              <div className="text-sm text-text-secondary">{formatFileSize(file.size)}</div>
              <div>
                <Badge color={file.status === "indexed" ? "green" : file.status === "pending" ? "yellow" : "gray"}>
                  {file.status}
                </Badge>
              </div>
              <div className="text-sm text-text-secondary">{formatDate(file.createdAt)}</div>
              <div>
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
