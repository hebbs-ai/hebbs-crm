// SPDX-License-Identifier: BUSL-1.1
//
// L9 — Pipeline configuration settings panel.
//
// Wires to the v2 tool dispatcher (`crm.pipelines.*`). v1 supports
// add / remove / reorder / probability edit on the default sales
// pipeline. Each stage mutation is its own tool call because the
// CRM dispatches stage CRUD individually (no bulk-update tool), and
// the previous v1 raw `/api/crm/pipelines` PATCH route doesn't
// exist in the module surface.

import { useEffect, useMemo, useState } from "react";
import { tool } from "../lib/api.js";

interface Stage {
  id: string;
  name: string;
  sortOrder: number;
  probability: number;
  type: string;
}

interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages?: Stage[];
}

export function PipelineSettingsSlot() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState("");

  const activePipeline = useMemo(
    () => pipelines.find((p) => p.id === activeId) ?? null,
    [pipelines, activeId],
  );

  async function refreshStages(pipelineId: string) {
    const res = await tool<{ data: Pipeline & { stages: Stage[] } }>(
      "crm.pipelines.get",
      { id: pipelineId },
    );
    setStages([...res.data.stages].sort((a, b) => a.sortOrder - b.sortOrder));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await tool<{ data: Pipeline[] }>("crm.pipelines.list", {});
        if (cancelled) return;
        setPipelines(res.data);
        const initial = res.data.find((p) => p.isDefault) ?? res.data[0];
        if (initial) setActiveId(initial.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    (async () => {
      try {
        await refreshStages(activeId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  async function persistReorder(next: Stage[]) {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      // Patch sortOrder + probability stage-by-stage. Stage creates/
      // deletes are handled by their dedicated callers below.
      for (const s of next) {
        await tool("crm.pipelines.update_stage", {
          pipelineId: activeId,
          id: s.id,
          sortOrder: s.sortOrder,
          probability: s.probability,
        });
      }
      await refreshStages(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function move(stageId: string, dir: -1 | 1) {
    const idx = stages.findIndex((s) => s.id === stageId);
    if (idx < 0) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= stages.length) return;
    const next = [...stages];
    const tmp = next[idx]!;
    next[idx] = next[swapWith]!;
    next[swapWith] = tmp;
    next.forEach((s, i) => {
      s.sortOrder = i;
    });
    void persistReorder(next);
  }

  async function updateProbability(stageId: string, value: number) {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      await tool("crm.pipelines.update_stage", {
        pipelineId: activeId,
        id: stageId,
        probability: value,
      });
      await refreshStages(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeStage(stageId: string) {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      await tool("crm.pipelines.delete_stage", {
        pipelineId: activeId,
        id: stageId,
      });
      await refreshStages(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addStage() {
    const name = newStageName.trim();
    if (!name || !activeId) return;
    setBusy(true);
    setError(null);
    try {
      await tool("crm.pipelines.create_stage", {
        pipelineId: activeId,
        name,
        sortOrder: stages.length,
        probability: 25,
        type: "open",
      });
      setNewStageName("");
      await refreshStages(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-slate-900">Pipeline configuration</h2>
        <p className="text-xs text-slate-500 mt-1">
          Add, remove, reorder stages or adjust their close probability.
        </p>
      </header>

      {pipelines.length > 1 && (
        <select
          value={activeId ?? ""}
          onChange={(e) => setActiveId(e.target.value)}
          className="text-sm border border-slate-300 rounded-md px-2 py-1"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {stages.map((stage, idx) => (
          <li
            key={stage.id}
            className="px-4 py-3 flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{stage.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                sort {stage.sortOrder} · type {stage.type}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={stage.probability}
                onChange={(e) => updateProbability(stage.id, Number(e.target.value))}
                className="w-16 text-xs border border-slate-300 rounded-md px-2 py-1"
              />
              <span className="text-xs text-slate-400">%</span>
              <button
                type="button"
                disabled={busy || idx === 0}
                onClick={() => move(stage.id, -1)}
                className="text-xs px-2 py-1 rounded-md bg-slate-100 disabled:opacity-50"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || idx === stages.length - 1}
                onClick={() => move(stage.id, 1)}
                className="text-xs px-2 py-1 rounded-md bg-slate-100 disabled:opacity-50"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeStage(stage.id)}
                className="text-xs px-2 py-1 rounded-md text-red-700 border border-red-200"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newStageName}
          onChange={(e) => setNewStageName(e.target.value)}
          placeholder="New stage name"
          className="flex-1 max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={addStage}
          disabled={busy || !newStageName.trim() || !activePipeline}
          className="px-3 py-2 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50"
        >
          Add stage
        </button>
      </div>
    </div>
  );
}
