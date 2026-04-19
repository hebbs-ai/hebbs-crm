import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  useWorkflow,
  useUpdateWorkflow,
  useExecuteWorkflow,
  useAgentsForWorkflow,
} from "../hooks/useWorkflows";
import type { WorkflowBlock, WorkflowEdge } from "../hooks/useWorkflows";
import { WorkflowCanvas, BlockPalette, BlockConfigForm } from "@boringos/workflow-ui";

function nextBlockId(blocks: WorkflowBlock[], baseType: string): string {
  // Generate a stable, readable id: "wake_1", "wake_2", "condition_1" …
  const base = baseType.replace(/-/g, "_");
  let n = 1;
  while (blocks.some((b) => b.id === `${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function nextBlockName(blocks: WorkflowBlock[], baseName: string): string {
  if (!blocks.some((b) => b.name === baseName)) return baseName;
  let n = 2;
  while (blocks.some((b) => b.name === `${baseName}_${n}`)) n++;
  return `${baseName}_${n}`;
}

export function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const wf = useWorkflow(id);
  const agentsQuery = useAgentsForWorkflow();
  const update = useUpdateWorkflow();
  const execute = useExecuteWorkflow();

  // Draft state — seeded from the loaded workflow, mutated as the user edits
  const [draftBlocks, setDraftBlocks] = useState<WorkflowBlock[]>([]);
  const [draftEdges, setDraftEdges] = useState<WorkflowEdge[]>([]);
  const [draftName, setDraftName] = useState<string>("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Save status surfaces in the header — replaces the silent failure where
  // a rejected PATCH left the user staring at "UNSAVED" with no explanation.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seed draft once the workflow loads
  useEffect(() => {
    if (wf.data) {
      setDraftBlocks(wf.data.blocks);
      setDraftEdges(wf.data.edges);
      setDraftName(wf.data.name);
      setDirty(false);
    }
  }, [wf.data]);

  // Warn on tab close / refresh when there are unsaved changes. We don't
  // intercept in-app navigation here because react-router's `useBlocker`
  // requires a data router, which the app currently doesn't use; revisit
  // if the app migrates to createBrowserRouter + RouterProvider.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const selectedBlock = selectedBlockId ? draftBlocks.find((b) => b.id === selectedBlockId) : null;

  // ── Editing actions ──────────────────────────────────────────────────────

  const handleGraphChange = useCallback((blocks: WorkflowBlock[], edges: WorkflowEdge[]) => {
    setDraftBlocks(blocks);
    setDraftEdges(edges);
    setDirty(true);
  }, []);

  const handleAddBlock = useCallback((starter: Omit<WorkflowBlock, "id">) => {
    setDraftBlocks((prev) => {
      const id = nextBlockId(prev, starter.type);
      const name = nextBlockName(prev, starter.name);
      const next = [...prev, { id, name, type: starter.type, config: starter.config }];
      setSelectedBlockId(id);
      setDirty(true);
      return next;
    });
  }, []);

  const handleBlockUpdate = useCallback((updates: { name?: string; config?: Record<string, unknown> }) => {
    if (!selectedBlockId) return;
    setDraftBlocks((prev) =>
      prev.map((b) => b.id === selectedBlockId ? {
        ...b,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.config !== undefined ? { config: updates.config } : {}),
      } : b)
    );
    setDirty(true);
  }, [selectedBlockId]);

  const handleBlockDelete = useCallback(() => {
    if (!selectedBlockId) return;
    setDraftBlocks((prev) => prev.filter((b) => b.id !== selectedBlockId));
    setDraftEdges((prev) => prev.filter((e) => e.sourceBlockId !== selectedBlockId && e.targetBlockId !== selectedBlockId));
    setSelectedBlockId(null);
    setDirty(true);
  }, [selectedBlockId]);

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaveError(null);
    try {
      const patch: Parameters<typeof update.mutateAsync>[0]["patch"] = {
        blocks: draftBlocks,
        edges: draftEdges,
      };
      const trimmed = draftName.trim();
      if (trimmed && trimmed !== wf.data?.name) patch.name = trimmed;
      await update.mutateAsync({ id, patch });
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [id, update, draftBlocks, draftEdges, draftName, wf.data?.name]);

  // Auto-clear the "Saved" indicator after a few seconds.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(t);
  }, [savedAt]);

  const handleRunNow = useCallback(async () => {
    if (!id) return;
    if (dirty) {
      const ok = confirm("Save changes before running?");
      if (ok) await handleSave();
      else return;
    }
    const r = await execute.mutateAsync({ id });
    if (r.runId) navigate(`/workflows/${id}/runs/${r.runId}`);
  }, [id, dirty, execute, handleSave, navigate]);

  // ── Validation (soft) ────────────────────────────────────────────────────

  const validation = useMemo(() => {
    const issues: string[] = [];
    if (draftBlocks.length === 0) issues.push("Workflow has no blocks");
    const triggers = draftBlocks.filter((b) => b.type === "trigger");
    if (triggers.length === 0) issues.push("No trigger block — workflow can't start");
    if (triggers.length > 1) issues.push("Multiple trigger blocks — only one allowed");
    // Orphan check: every non-trigger must have an incoming edge
    const hasIncoming = new Set(draftEdges.map((e) => e.targetBlockId));
    for (const b of draftBlocks) {
      if (b.type !== "trigger" && !hasIncoming.has(b.id)) {
        issues.push(`Block "${b.name}" has no incoming edge`);
      }
    }
    return issues;
  }, [draftBlocks, draftEdges]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (wf.isLoading) return <div className="p-6 text-sm text-text-secondary">Loading…</div>;
  if (!wf.data) return <div className="p-6 text-sm text-text-secondary">Workflow not found</div>;
  const workflow = wf.data;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 border-b border-border px-4 py-2 flex items-center gap-3">
        <Link to={`/workflows/${id}`} className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"}</Link>
        <input
          type="text"
          value={draftName}
          onChange={(e) => { setDraftName(e.target.value); setDirty(true); }}
          placeholder="Untitled workflow"
          className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate bg-transparent border-0 px-1 py-0.5 rounded hover:bg-bg-hover focus:bg-bg-secondary focus:outline-none focus:ring-1 focus:ring-accent"
          aria-label="Workflow name"
        />
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">{workflow.type} · {workflow.status}</span>
        {/* Save status — explicit feedback so a rejected save doesn't fail silently. */}
        {saveError ? (
          <span className="text-[10px] text-text-red font-semibold" title={saveError}>SAVE FAILED</span>
        ) : savedAt ? (
          <span className="text-[10px] text-text-green font-semibold">SAVED</span>
        ) : dirty ? (
          <span className="text-[10px] text-text-amber font-semibold">UNSAVED</span>
        ) : null}
        <button
          onClick={handleRunNow}
          disabled={execute.isPending || workflow.status === "archived"}
          className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-bg-hover disabled:opacity-50"
        >
          {execute.isPending ? "Running…" : "Run now"}
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty || update.isPending}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </header>

      {/* Save error banner — shows below the top bar with the full message and a dismiss. */}
      {saveError && (
        <div className="shrink-0 border-b border-text-red/40 bg-surface-red/30 px-4 py-1.5 text-xs text-text-red flex items-center gap-3">
          <span className="font-semibold">Couldn't save:</span>
          <span className="flex-1 truncate" title={saveError}>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-text-red/70 hover:text-text-red">Dismiss</button>
        </div>
      )}

      {/* Validation warnings bar */}
      {validation.length > 0 && (
        <div className="shrink-0 border-b border-border bg-surface-amber/50 px-4 py-1.5 text-xs text-text-amber">
          {validation.length} issue{validation.length === 1 ? "" : "s"}: {validation.slice(0, 3).join(" · ")}
          {validation.length > 3 && ` · +${validation.length - 3} more`}
        </div>
      )}

      {/* Body: palette | canvas | config */}
      <div className="flex-1 flex overflow-hidden">
        <BlockPalette onAdd={handleAddBlock} />

        <div className="flex-1 flex flex-col overflow-hidden">
          <WorkflowCanvas
            blocks={draftBlocks}
            edges={draftEdges}
            mode="edit"
            onGraphChange={handleGraphChange}
            selectedBlockId={selectedBlockId}
            onBlockClick={setSelectedBlockId}
            height="100%"
          />
        </div>

        <aside className="w-[360px] shrink-0 border-l border-border overflow-y-auto p-3">
          {selectedBlock ? (
            <BlockConfigForm
              block={selectedBlock}
              onChange={handleBlockUpdate}
              onDelete={handleBlockDelete}
              agents={agentsQuery.data?.agents ?? []}
            />
          ) : (
            <div className="text-center text-xs text-text-tertiary py-12">
              Select a block to configure it, or pick one from the palette to add.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
