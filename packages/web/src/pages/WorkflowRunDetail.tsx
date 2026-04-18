import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useWorkflowRun, useWorkflow, useReplayRun } from "../hooks/useWorkflows";
import type { BlockRun, BlockRunStatus } from "../hooks/useWorkflows";
import { WorkflowCanvas } from "../components/WorkflowCanvas";

function blockStatusColor(status: BlockRunStatus): string {
  return status === "completed" ? "text-text-green"
    : status === "failed" ? "text-text-red"
    : status === "running" ? "text-text-amber"
    : status === "skipped" ? "text-text-tertiary"
    : "text-text-secondary";
}

function blockStatusDot(status: BlockRunStatus): string {
  return status === "completed" ? "bg-text-green"
    : status === "failed" ? "bg-text-red"
    : status === "running" ? "bg-text-amber animate-pulse"
    : status === "skipped" ? "bg-text-tertiary"
    : "bg-text-secondary";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function BlockRunCard({ block, forceOpen }: { block: BlockRun; forceOpen?: boolean }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = forceOpen || localOpen;
  return (
    <div className={`border rounded-md overflow-hidden transition-colors ${forceOpen ? "border-accent" : "border-border"}`} id={`block-${block.blockId}`}>
      <button
        onClick={() => setLocalOpen(!localOpen)}
        className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-bg-hover text-left"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${blockStatusDot(block.status)}`} />
        <span className="font-medium text-sm text-text-primary">{block.blockName}</span>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary px-1.5 py-0.5 rounded border border-border">
          {block.blockType}
        </span>
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${blockStatusColor(block.status)}`}>
          {block.status}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-text-tertiary">{formatDuration(block.durationMs)}</span>
        <span className="text-text-tertiary">{open ? "\u25BE" : "\u25B8"}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3 space-y-3 bg-bg-secondary">
          {block.error && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Error</div>
              <pre className="text-xs text-text-red whitespace-pre-wrap">{block.error}</pre>
            </div>
          )}
          {block.selectedHandle && (
            <div className="text-xs">
              <span className="text-text-tertiary">Branch taken: </span>
              <span className="font-mono text-text-primary">{block.selectedHandle}</span>
            </div>
          )}
          {block.resolvedConfig && Object.keys(block.resolvedConfig).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Resolved config</div>
              <pre className="text-xs bg-bg border border-border rounded p-2 overflow-x-auto">{JSON.stringify(block.resolvedConfig, null, 2)}</pre>
            </div>
          )}
          {block.inputContext && Object.keys(block.inputContext).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Input context</div>
              <pre className="text-xs bg-bg border border-border rounded p-2 overflow-x-auto">{JSON.stringify(block.inputContext, null, 2)}</pre>
            </div>
          )}
          {block.output && Object.keys(block.output).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Output</div>
              <pre className="text-xs bg-bg border border-border rounded p-2 overflow-x-auto">{JSON.stringify(block.output, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowRunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const { data, isLoading } = useWorkflowRun(runId);
  const wf = useWorkflow(id);
  const replay = useReplayRun();

  if (isLoading) return <div className="p-6 text-sm text-text-secondary">Loading…</div>;
  if (!data) return <div className="p-6 text-sm text-text-secondary">Run not found</div>;

  const { run, blocks } = data;
  const selectedBlock = selectedBlockId ? blocks.find((b) => b.blockId === selectedBlockId) : null;
  // Replay is only useful once a run has reached a terminal state. Running /
  // queued runs have nothing meaningful to replay yet.
  const canReplay = run.status === "completed" || run.status === "failed" || run.status === "cancelled";

  async function handleReplay() {
    if (!runId) return;
    const res = await replay.mutateAsync(runId);
    navigate(`/workflows/${id}/runs/${res.runId}`);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-2">
          <Link to={`/workflows/${id}`} className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Back to workflow</Link>
        </div>

        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary font-mono">Run {run.id.slice(0, 8)}</h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
              <span className={`uppercase tracking-wide font-semibold ${run.status === "completed" ? "text-text-green" : run.status === "failed" ? "text-text-red" : run.status === "waiting_for_human" ? "text-text-purple" : "text-text-amber"}`}>
                {run.status.replace("_", " ")}
              </span>
              <span>·</span>
              <span>{run.triggerType}</span>
              <span>·</span>
              <span>{formatDuration(run.durationMs)}</span>
              <span>·</span>
              <span>{run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</span>
            </div>
            {run.error && <div className="mt-2 text-sm text-text-red">{run.error}</div>}
          </div>
          {canReplay && (
            <button
              onClick={handleReplay}
              disabled={replay.isPending}
              className="text-xs font-medium px-3 py-1.5 rounded border border-border hover:bg-bg-hover text-text-primary disabled:opacity-50"
              title="Re-execute this workflow with the same trigger payload"
            >
              {replay.isPending ? "Replaying…" : "\u21BB Replay"}
            </button>
          )}
        </header>

        {/* Visual DAG with per-block status overlaid. Click a node to jump to its detail. */}
        {wf.data && (
          <section className="mb-6">
            <WorkflowCanvas
              blocks={wf.data.blocks}
              edges={wf.data.edges}
              blockRuns={blocks}
              selectedBlockId={selectedBlockId}
              onBlockClick={setSelectedBlockId}
              height={360}
            />
            {selectedBlock && (
              <div className="mt-2 text-xs text-text-tertiary text-center">
                ↓ Detail for <span className="font-mono text-text-secondary">{selectedBlock.blockName}</span> ↓
              </div>
            )}
          </section>
        )}

        {run.triggerPayload && Object.keys(run.triggerPayload).length > 0 && (
          <section className="mb-6">
            <h3 className="text-xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">Trigger payload</h3>
            <pre className="text-xs bg-bg-secondary border border-border rounded-md p-3 overflow-x-auto">{JSON.stringify(run.triggerPayload, null, 2)}</pre>
          </section>
        )}

        <section>
          <h3 className="text-xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
            Blocks ({blocks.length})
          </h3>
          <div className="space-y-2">
            {blocks.map((b) => (
              <BlockRunCard
                key={b.id}
                block={b}
                forceOpen={selectedBlockId === b.blockId}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
