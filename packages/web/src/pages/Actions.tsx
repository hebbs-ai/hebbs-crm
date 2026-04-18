import { useState } from "react";
import { useActions } from "../hooks/useActions";
import { ActionCard } from "../components/ActionCard";

export function ActionsPage() {
  const [filter, setFilter] = useState<"all" | "agent_action" | "human_todo" | "agent_blocked">("all");
  const { data, isLoading } = useActions({
    status: "todo",
    kind: filter === "all" ? undefined : filter,
  });

  const items = data?.data ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Actions</h1>
        <p className="text-sm text-text-secondary mt-1">
          What your agents have surfaced for you to approve, do, or answer. Nothing falls off the radar.
        </p>
      </header>

      <div className="flex items-center gap-2 mb-4 text-sm">
        {([
          ["all", "All"],
          ["agent_action", "Approvals"],
          ["human_todo", "To-dos"],
          ["agent_blocked", "Awaiting you"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded-md transition-colors ${
              filter === k
                ? "bg-bg-hover text-text-primary font-medium"
                : "text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-text-secondary">Loading…</div>}
      {!isLoading && items.length === 0 && (
        <div className="text-center py-12 text-sm text-text-tertiary">
          Nothing pending. Agents haven't surfaced anything for you yet.
        </div>
      )}
      <div className="space-y-3">
        {items.map((a) => <ActionCard key={a.id} action={a} />)}
      </div>
    </div>
  );
}
