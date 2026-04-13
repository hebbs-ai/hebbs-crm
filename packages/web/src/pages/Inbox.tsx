import { useState } from "react";
import { useInbox, useArchiveInboxItem, useCreateTaskFromInbox } from "../hooks/useInbox";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";

const STATUS_TABS = [
  { label: "All", value: undefined },
  { label: "Unread", value: "unread" },
  { label: "Read", value: "read" },
  { label: "Archived", value: "archived" },
] as const;

const SOURCE_COLORS: Record<string, "red" | "blue" | "green" | "gray"> = {
  gmail: "red",
  slack: "blue",
  form: "green",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function InboxPage() {
  const [activeStatus, setActiveStatus] = useState<string | undefined>(undefined);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const { data, isLoading } = useInbox(activeStatus);
  const archiveItem = useArchiveInboxItem();
  const createTask = useCreateTaskFromInbox();

  const items = data?.items ?? [];

  const handleCreateTask = async (id: string) => {
    try {
      await createTask.mutateAsync(id);
      setSuccessMsg("Task created successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      // error shown via mutation state
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveItem.mutateAsync(id);
    } catch {
      // error shown via mutation state
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Inbox"
        subtitle={`${items.length} item${items.length !== 1 ? "s" : ""}`}
      />

      {successMsg && (
        <div className="mb-4 rounded-md bg-surface-green px-4 py-2 text-sm text-text-green">
          {successMsg}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveStatus(tab.value)}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeStatus === tab.value
                ? "border-accent text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading...</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <span className="text-4xl mb-3">{"\u2709"}</span>
          <p className="text-sm">No inbox items</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-bg-secondary transition-colors"
            >
              <div className="pt-0.5">
                <Badge color={SOURCE_COLORS[item.source] ?? "gray"}>
                  {item.source}
                </Badge>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary truncate">
                    {item.subject}
                  </span>
                  {item.status === "unread" && (
                    <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                  )}
                </div>
                <div className="text-xs text-text-secondary mt-0.5">{item.from}</div>
                <div className="text-xs text-text-tertiary mt-1 line-clamp-2">
                  {item.body}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className="text-xs text-text-tertiary whitespace-nowrap">
                  {timeAgo(item.createdAt)}
                </span>
                <div className="flex gap-1">
                  {item.status !== "archived" && (
                    <button
                      onClick={() => handleArchive(item.id)}
                      disabled={archiveItem.isPending}
                      className="rounded border border-border px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-50"
                    >
                      Archive
                    </button>
                  )}
                  {!item.linkedTaskId && (
                    <button
                      onClick={() => handleCreateTask(item.id)}
                      disabled={createTask.isPending}
                      className="rounded border border-border px-2 py-0.5 text-xs text-accent hover:bg-bg-hover transition-colors disabled:opacity-50"
                    >
                      Create Task
                    </button>
                  )}
                  {item.linkedTaskId && (
                    <Badge color="green">Task linked</Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
