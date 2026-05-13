// SPDX-License-Identifier: BUSL-1.1
//
// Maintenance settings panel.
//
// Single card with one button: "Run inbox cleanup". Calls
// `crm.maintenance.start { kind: "purge_review" }` which creates
// a task assigned to the crm-maintenance agent. The agent then
// posts the candidate list as a task comment and waits for a
// "yes" / "no" / "yes but skip X" reply. No counts or list view
// inline — the task IS the cleanup UI.

import { useState } from "react";
import { tool } from "../lib/api.js";

export function MaintenanceSettingsSlot() {
  const [busy, setBusy] = useState(false);
  const [lastTask, setLastTask] = useState<{ taskId: string; taskUrl: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function runCleanup() {
    setBusy(true);
    setError(null);
    try {
      const result = await tool<{ taskId: string; taskUrl: string; agentId: string }>(
        "crm.maintenance.start",
        { kind: "purge_review" },
      );
      setLastTask({ taskId: result.taskId, taskUrl: result.taskUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start cleanup task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <header>
        <h2 className="text-base font-semibold text-slate-900">Maintenance</h2>
        <p className="text-xs text-slate-500 mt-1">
          Tools that operate on CRM data in bulk. Each one creates a task you
          can review before anything is written.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Inbox cleanup</h3>
        <p className="mt-1 text-sm text-slate-600">
          Auto-created contacts, companies, and deals that turned out to be
          newsletters or automated mail. The maintenance agent will scan, list
          candidates as a task comment, and ask you to approve before deleting
          anything.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runCleanup}
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Run inbox cleanup"}
          </button>

          {lastTask && (
            <a
              href={lastTask.taskUrl}
              className="text-sm text-accent hover:underline"
            >
              Open task →
            </a>
          )}
        </div>

        {lastTask && (
          <p className="mt-3 text-xs text-slate-500">
            Cleanup task created. The agent will post the candidate list there
            and wait for your reply.
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
