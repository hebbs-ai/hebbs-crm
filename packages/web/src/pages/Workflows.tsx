import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkflows, useUpdateWorkflowStatus, useExecuteWorkflow, useCreateWorkflow } from "../hooks/useWorkflows";
import type { Workflow, WorkflowStatus } from "../hooks/useWorkflows";

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const color = status === "active" ? "bg-surface-green text-text-green"
    : status === "paused" ? "bg-surface-amber text-text-amber"
    : status === "archived" ? "bg-bg-secondary text-text-tertiary"
    : "bg-bg-secondary text-text-secondary";
  return <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${color}`}>{status}</span>;
}

function TypeBadge({ type }: { type: Workflow["type"] }) {
  return (
    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${type === "system" ? "border-border text-text-tertiary" : "border-accent/40 text-accent"}`}>
      {type}
    </span>
  );
}

export function WorkflowsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useWorkflows();
  const updateStatus = useUpdateWorkflowStatus();
  const execute = useExecuteWorkflow();
  const createWorkflow = useCreateWorkflow();
  const [creating, setCreating] = useState(false);

  const workflows = data?.workflows ?? [];

  async function onNewWorkflow() {
    // Skip the prompt — create with a placeholder name and jump straight
    // into the editor where the user can rename inline. Same number of
    // clicks, no native dialog interrupting flow.
    setCreating(true);
    try {
      const wf = await createWorkflow.mutateAsync({ name: "Untitled workflow" });
      navigate(`/workflows/${wf.id}/edit`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Workflows</h1>
            <p className="text-sm text-text-secondary mt-1">
              Event-driven automations. Each workflow is a DAG of blocks triggered by events, cron, or manual runs.
            </p>
          </div>
          <button
            onClick={onNewWorkflow}
            disabled={creating}
            className="shrink-0 px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Creating…" : "+ New workflow"}
          </button>
        </header>

        {isLoading && <div className="text-sm text-text-secondary">Loading…</div>}
        {!isLoading && workflows.length === 0 && (
          <div className="text-center py-12 text-sm text-text-tertiary">
            No workflows yet.
          </div>
        )}

        <div className="space-y-2">
          {workflows.map((wf) => (
            <div key={wf.id} className="border border-border rounded-md p-4 bg-bg hover:bg-bg-hover transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type={wf.type} />
                    <StatusBadge status={wf.status} />
                    <span className="text-[10px] text-text-tertiary">{wf.blocks.length} blocks</span>
                  </div>
                  <Link to={`/workflows/${wf.id}`} className="text-sm font-medium text-text-primary hover:text-accent">
                    {wf.name}
                  </Link>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link
                    to={`/workflows/${wf.id}/edit`}
                    className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-bg-hover"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => execute.mutate({ id: wf.id })}
                    disabled={execute.isPending || wf.status === "archived"}
                    className="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
                  >
                    Run now
                  </button>
                  {wf.status === "active" && (
                    <button
                      onClick={() => updateStatus.mutate({ id: wf.id, status: "paused" })}
                      className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-bg-hover"
                    >
                      Pause
                    </button>
                  )}
                  {wf.status === "paused" && (
                    <button
                      onClick={() => updateStatus.mutate({ id: wf.id, status: "active" })}
                      className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-bg-hover"
                    >
                      Activate
                    </button>
                  )}
                  {wf.status !== "archived" && (
                    <button
                      onClick={() => updateStatus.mutate({ id: wf.id, status: "archived" })}
                      className="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
