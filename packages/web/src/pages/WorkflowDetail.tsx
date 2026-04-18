import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWorkflow, useWorkflowRuns, useExecuteWorkflow, useUpdateWorkflowStatus } from "../hooks/useWorkflows";
import type { WorkflowRunStatus } from "../hooks/useWorkflows";

function runStatusColor(status: WorkflowRunStatus): string {
  return status === "completed" ? "text-text-green"
    : status === "failed" ? "text-text-red"
    : status === "running" || status === "queued" ? "text-text-amber"
    : status === "cancelled" ? "text-text-tertiary"
    : "text-text-secondary";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"runs" | "definition">("runs");

  const wf = useWorkflow(id);
  const runs = useWorkflowRuns(id);
  const execute = useExecuteWorkflow();
  const updateStatus = useUpdateWorkflowStatus();

  if (wf.isLoading) return <div className="p-6 text-sm text-text-secondary">Loading…</div>;
  if (!wf.data) return <div className="p-6 text-sm text-text-secondary">Workflow not found</div>;

  const workflow = wf.data;
  const runList = runs.data?.runs ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-2">
          <Link to="/workflows" className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Workflows</Link>
        </div>

        {/* Header */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-text-primary">{workflow.name}</h1>
            <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
              <span>{workflow.type}</span>
              <span>·</span>
              <span className="capitalize">{workflow.status}</span>
              <span>·</span>
              <span>{workflow.blocks.length} blocks, {workflow.edges.length} edges</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => execute.mutate({ id: workflow.id })}
              disabled={execute.isPending || workflow.status === "archived"}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {execute.isPending ? "Running…" : "Run now"}
            </button>
            {workflow.status === "active" && (
              <button
                onClick={() => updateStatus.mutate({ id: workflow.id, status: "paused" })}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-hover"
              >
                Pause
              </button>
            )}
            {workflow.status === "paused" && (
              <button
                onClick={() => updateStatus.mutate({ id: workflow.id, status: "active" })}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-hover"
              >
                Activate
              </button>
            )}
          </div>
        </header>

        {execute.isSuccess && execute.data?.runId && (
          <div className="mb-4 p-3 rounded-md border border-border bg-bg-secondary text-sm">
            Run started: <Link to={`/workflows/${workflow.id}/runs/${execute.data.runId}`} className="text-accent hover:underline font-mono">{execute.data.runId.slice(0, 8)}</Link>
            {" "}({execute.data.status})
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border mb-4">
          <button
            onClick={() => setTab("runs")}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === "runs" ? "border-accent text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
          >
            Run history ({runList.length})
          </button>
          <button
            onClick={() => setTab("definition")}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === "definition" ? "border-accent text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
          >
            Definition
          </button>
        </div>

        {tab === "runs" && (
          <div className="space-y-1">
            {runs.isLoading && <div className="text-sm text-text-secondary">Loading…</div>}
            {!runs.isLoading && runList.length === 0 && (
              <div className="text-center py-12 text-sm text-text-tertiary">No runs yet. Hit "Run now" to trigger one.</div>
            )}
            {runList.map((r) => (
              <Link
                key={r.id}
                to={`/workflows/${workflow.id}/runs/${r.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-bg-hover border border-transparent hover:border-border transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`text-[10px] uppercase tracking-wide font-semibold ${runStatusColor(r.status)}`}>
                    {r.status}
                  </span>
                  <span className="font-mono text-xs text-text-tertiary">{r.id.slice(0, 8)}</span>
                  <span className="text-xs text-text-tertiary">{r.triggerType}</span>
                  {r.error && <span className="text-xs text-text-red truncate">· {r.error.slice(0, 80)}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-text-tertiary">
                  <span>{formatDuration(r.durationMs)}</span>
                  <span>{formatRelative(r.startedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {tab === "definition" && (
          <div className="space-y-4">
            <section>
              <h3 className="text-xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">Blocks ({workflow.blocks.length})</h3>
              <div className="space-y-1">
                {workflow.blocks.map((b) => (
                  <div key={b.id} className="border border-border rounded-md p-3 bg-bg text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-text-tertiary">{b.id}</span>
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary px-1.5 py-0.5 rounded border border-border">{b.type}</span>
                    </div>
                    {Object.keys(b.config).length > 0 && (
                      <pre className="mt-2 text-xs bg-bg-secondary border border-border rounded p-2 overflow-x-auto">{JSON.stringify(b.config, null, 2)}</pre>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3 className="text-xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">Edges ({workflow.edges.length})</h3>
              <div className="space-y-1 font-mono text-xs">
                {workflow.edges.map((e) => (
                  <div key={e.id} className="text-text-secondary">
                    {e.sourceBlockId} → {e.targetBlockId}
                    {e.sourceHandle && <span className="text-text-tertiary"> (handle: {e.sourceHandle})</span>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
