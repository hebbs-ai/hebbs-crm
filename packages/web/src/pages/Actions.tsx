import { useState } from "react";
import { useActions, useExecuteAction, useDismissAction, useCompleteAction, type ActionItem } from "../hooks/useActions";
import { ActionCard } from "../components/ActionCard";

type Filter = "all" | "agent_action" | "human_todo" | "agent_blocked";

export function ActionsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"pending" | "resolved">("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useActions({
    status: view === "pending" ? "todo" : "resolved",
    kind: filter === "all" ? undefined : filter,
  });
  const items = data?.data ?? [];

  const execute = useExecuteAction();
  const dismiss = useDismissAction();
  const complete = useCompleteAction();
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  function selectedItems(): ActionItem[] {
    return items.filter((a) => selected.has(a.id));
  }

  async function bulkApprove() {
    setBulkBusy("approve");
    try {
      await Promise.all(
        selectedItems()
          .filter((a) => a.originKind === "agent_action")
          .map((a) => execute.mutateAsync({ id: a.id })),
      );
      clearSelection();
    } finally { setBulkBusy(null); }
  }
  async function bulkComplete() {
    setBulkBusy("complete");
    try {
      await Promise.all(
        selectedItems()
          .filter((a) => a.originKind === "human_todo")
          .map((a) => complete.mutateAsync(a.id)),
      );
      clearSelection();
    } finally { setBulkBusy(null); }
  }
  async function bulkDismiss() {
    setBulkBusy("dismiss");
    try {
      await Promise.all(selectedItems().map((a) => dismiss.mutateAsync(a.id)));
      clearSelection();
    } finally { setBulkBusy(null); }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Actions</h1>
        <p className="text-sm text-text-secondary mt-1">
          What your agents have surfaced for you to approve, do, or answer. Nothing falls off the radar.
        </p>
      </header>

      <div className="flex items-center justify-between mb-4 text-sm">
        <div className="flex items-center gap-2">
          {([
            ["all", "All"],
            ["agent_action", "Approvals"],
            ["human_todo", "To-dos"],
            ["agent_blocked", "Awaiting you"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setFilter(k); clearSelection(); }}
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
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => { setView("pending"); clearSelection(); }}
            className={`px-2 py-1 rounded ${view === "pending" ? "bg-bg-hover text-text-primary" : "text-text-secondary hover:bg-bg-hover"}`}
          >
            Pending
          </button>
          <button
            onClick={() => { setView("resolved"); clearSelection(); }}
            className={`px-2 py-1 rounded ${view === "resolved" ? "bg-bg-hover text-text-primary" : "text-text-secondary hover:bg-bg-hover"}`}
          >
            Recently resolved
          </button>
        </div>
      </div>

      {selected.size > 0 && view === "pending" && (
        <div className="sticky top-0 z-10 -mx-6 px-6 py-2 mb-3 border-b border-border bg-bg flex items-center gap-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="flex-1" />
          <button
            onClick={bulkApprove}
            disabled={bulkBusy !== null}
            className="px-3 py-1.5 bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {bulkBusy === "approve" ? "..." : "Approve all"}
          </button>
          <button
            onClick={bulkComplete}
            disabled={bulkBusy !== null}
            className="px-3 py-1.5 border border-border rounded-md hover:bg-bg-hover disabled:opacity-50"
          >
            Mark to-dos done
          </button>
          <button
            onClick={bulkDismiss}
            disabled={bulkBusy !== null}
            className="px-3 py-1.5 border border-border rounded-md hover:bg-bg-hover disabled:opacity-50"
          >
            Dismiss all
          </button>
          <button
            onClick={clearSelection}
            className="px-2 py-1.5 text-text-tertiary hover:text-text-secondary"
          >
            Clear
          </button>
        </div>
      )}

      {isLoading && <div className="text-sm text-text-secondary">Loading…</div>}
      {!isLoading && items.length === 0 && (
        <div className="text-center py-12 text-sm text-text-tertiary">
          {view === "pending" ? "Nothing pending. Agents haven't surfaced anything for you yet." : "No recently resolved items."}
        </div>
      )}
      <div className="space-y-3">
        {items.map((a) => (
          <div key={a.id} className="flex items-start gap-2">
            {view === "pending" && (
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                onChange={() => toggle(a.id)}
                className="mt-5 shrink-0"
                aria-label="select action"
              />
            )}
            <div className="flex-1 min-w-0">
              <ActionCard action={a} />
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
