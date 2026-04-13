import { useState } from "react";
import { Link } from "react-router-dom";
import { useEntityRefs, useLinkEntity } from "../hooks/useEntityRefs";
import { useTasks, useCreateTask } from "../hooks/useTasks";
import { Modal } from "./ui/Modal";
import { Badge } from "./ui/Badge";
import { Input, Select, Textarea } from "./ui/FormField";

const STATUS_COLORS: Record<string, "gray" | "blue" | "green" | "red"> = {
  todo: "gray",
  in_progress: "blue",
  done: "green",
  blocked: "red",
};

const PRIORITY_COLORS: Record<string, "red" | "orange" | "yellow" | "gray"> = {
  urgent: "red",
  high: "orange",
  medium: "yellow",
  low: "gray",
};

function formatStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface EntityTasksProps {
  entityType: string;
  entityId: string;
}

export function EntityTasks({ entityType, entityId }: EntityTasksProps) {
  const [showCreate, setShowCreate] = useState(false);
  const { data: refsData } = useEntityRefs(entityType, entityId);
  const { data: tasksData } = useTasks();
  const createTask = useCreateTask();
  const linkEntity = useLinkEntity();

  const refs = refsData?.data ?? [];
  const allTasks = tasksData?.data ?? [];

  // Filter tasks that are linked to this entity via refs
  const linkedTaskIds = new Set(
    refs.filter((r) => r.refType === "task").map((r) => r.refId),
  );
  const linkedTasks = allTasks.filter((t) => linkedTaskIds.has(t.id));

  const [form, setForm] = useState({ title: "", description: "", priority: "medium" });
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createTask.mutate(
      {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
      },
      {
        onSuccess: (result) => {
          const newTask = result.data;
          linkEntity.mutate({
            entityType,
            entityId,
            refType: "task",
            refId: newTask.id,
          });
          setForm({ title: "", description: "", priority: "medium" });
          setShowCreate(false);
        },
      },
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          Tasks
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs text-accent hover:text-accent-hover transition-colors font-medium"
        >
          + New Task
        </button>
      </div>

      {linkedTasks.length === 0 ? (
        <p className="text-sm text-text-tertiary py-3">No tasks linked</p>
      ) : (
        <div className="rounded-lg border border-border">
          {linkedTasks.map((t, i) => (
            <Link
              key={t.id}
              to={`/tasks/${t.id}`}
              className={`flex items-center justify-between px-4 py-2.5 hover:bg-bg-secondary transition-colors ${
                i < linkedTasks.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-text-primary truncate">
                  {t.title}
                </span>
                {t.assigneeAgentId && (
                  <Badge color="purple">Agent</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {t.priority && (
                  <Badge color={PRIORITY_COLORS[t.priority] ?? "gray"}>
                    {t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}
                  </Badge>
                )}
                <Badge color={STATUS_COLORS[t.status] ?? "gray"}>
                  {formatStatus(t.status)}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Task">
        <form onSubmit={handleCreate}>
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
              onClick={() => setShowCreate(false)}
              className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createTask.isPending || !form.title.trim()}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {createTask.isPending ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
