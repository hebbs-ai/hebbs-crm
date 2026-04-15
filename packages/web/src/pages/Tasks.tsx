import { useState } from "react";
import { Link } from "react-router-dom";
import { useTasks, useCreateTask } from "../hooks/useTasks";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Input, Select, Textarea } from "../components/ui/FormField";

type StatusFilter = "" | "todo" | "in_progress" | "done" | "blocked";

const PRIORITY_COLORS: Record<string, "red" | "orange" | "yellow" | "gray"> = {
  urgent: "red",
  high: "orange",
  medium: "yellow",
  low: "gray",
};

const STATUS_COLORS: Record<string, "gray" | "blue" | "green" | "red"> = {
  todo: "gray",
  in_progress: "blue",
  done: "green",
  blocked: "red",
};

function formatStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function NewTaskForm({
  onSubmit,
  onCancel,
  loading,
}: {
  onSubmit: (data: { title: string; description?: string; priority?: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({ title: "", description: "", priority: "medium" });
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: form.title,
      description: form.description || undefined,
      priority: form.priority,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <Input
        label="Title"
        value={form.title}
        onChange={(e) => set("title", (e.target as HTMLInputElement).value)}
        required
      />
      <Textarea
        label="Description"
        value={form.description}
        onChange={(e) => set("description", (e.target as HTMLTextAreaElement).value)}
        className="mt-3"
      />
      <Select
        label="Priority"
        value={form.priority}
        onChange={(e) => set("priority", (e.target as HTMLSelectElement).value)}
        options={[
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ]}
        className="mt-3"
      />
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !form.title.trim()}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Task"}
        </button>
      </div>
    </form>
  );
}

export function TasksPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [showCreate, setShowCreate] = useState(false);
  const [showSystem, setShowSystem] = useState(false);

  const { data, isLoading } = useTasks(
    statusFilter ? { status: statusFilter } : undefined,
  );
  const createTask = useCreateTask();

  const allTasks = data?.data ?? [];
  const userTasks = allTasks.filter(
    (t) => !(t as any).originKind || (t as any).originKind === "manual",
  );
  const tasks = showSystem ? allTasks : userTasks;
  const systemCount = allTasks.length - userTasks.length;

  const filters: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "" },
    { label: "To Do", value: "todo" },
    { label: "In Progress", value: "in_progress" },
    { label: "Done", value: "done" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Tasks"
        subtitle={`${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            + New Task
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-1">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f.value
                ? "bg-bg-hover text-text-primary"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
          >
            {f.label}
          </button>
        ))}
        {systemCount > 0 && (
          <button
            onClick={() => setShowSystem(!showSystem)}
            className={`ml-auto rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              showSystem
                ? "bg-bg-hover text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {showSystem ? "Hide" : "Show"} system tasks ({systemCount})
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary py-8 text-center">Loading...</p>
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description={statusFilter ? "Try a different filter" : "Create your first task to get started"}
          action={!statusFilter ? { label: "New Task", onClick: () => setShowCreate(true) } : undefined}
        />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">
                Identifier
              </th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">
                Title
              </th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">
                Priority
              </th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">
                Status
              </th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">
                Assignee
              </th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="hover:bg-bg-secondary transition-colors">
                <td className="px-3 py-2.5 border-b border-border text-sm text-text-tertiary font-mono">
                  {(t as any).identifier ?? "\u2014"}
                </td>
                <td className="px-3 py-2.5 border-b border-border">
                  <Link to={`/tasks/${t.id}`} className="font-medium text-text-primary hover:text-accent">
                    {t.title}
                  </Link>
                  {(t as any).originKind === "copilot" && (
                    <span className="ml-1.5 inline-flex items-center rounded px-1 py-0 text-[10px] font-medium bg-surface-blue text-text-blue" title="Created by copilot">
                      {"\u25C7"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 border-b border-border">
                  {t.priority ? (
                    <Badge color={PRIORITY_COLORS[t.priority] ?? "gray"}>
                      {t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}
                    </Badge>
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="px-3 py-2.5 border-b border-border">
                  <Badge color={STATUS_COLORS[t.status] ?? "gray"}>
                    {formatStatus(t.status)}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 border-b border-border text-sm text-text-secondary">
                  {t.assigneeAgentId ? (
                    <Badge color="purple">Agent</Badge>
                  ) : t.assigneeUserId ? (
                    t.assigneeUserId
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="px-3 py-2.5 border-b border-border text-sm text-text-secondary">
                  {new Date(t.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Task">
        <NewTaskForm
          onSubmit={(data) => {
            createTask.mutate(data, { onSuccess: () => setShowCreate(false) });
          }}
          onCancel={() => setShowCreate(false)}
          loading={createTask.isPending}
        />
      </Modal>
    </div>
  );
}
