import { useState, useMemo } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { useAgents, useOrgTree, useUpdateAgent, useUpdateAgentSkills, useCreateAgent, useRuntimes, useTenantSettings, useUpdateTenantSettings, type Agent, type OrgNode } from "../hooks/useAgents";
import { useAuth } from "../lib/auth";

const STATUS_COLORS: Record<string, "gray" | "blue" | "green" | "red" | "orange"> = {
  idle: "gray",
  running: "blue",
  paused: "orange",
  archived: "gray",
  error: "red",
};

function flattenTree(nodes: OrgNode[], depth = 0): Array<{ agent: OrgNode; depth: number }> {
  const out: Array<{ agent: OrgNode; depth: number }> = [];
  for (const n of nodes) {
    out.push({ agent: n, depth });
    if (n.reports?.length > 0) out.push(...flattenTree(n.reports, depth + 1));
  }
  return out;
}

export function AgentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: tree, isLoading: treeLoading } = useOrgTree();
  const { data: allAgents } = useAgents();
  const { data: runtimes } = useRuntimes();
  const { data: settings } = useTenantSettings();
  const updateSettings = useUpdateTenantSettings();
  const agentsPaused = settings?.agents_paused === "true";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const handleGlobalPauseToggle = () => {
    updateSettings.mutate({ agents_paused: agentsPaused ? "false" : "true" });
  };

  const flat = useMemo(() => (tree ? flattenTree(tree) : []), [tree]);
  const selected = allAgents?.find((a) => a.id === selectedId) ?? null;
  // Auto-select first agent on load
  if (!selectedId && flat.length > 0) {
    setSelectedId(flat[0].agent.id);
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-8 pb-0 max-w-[1400px]">
      <PageHeader
        title="Agents"
        subtitle={`${allAgents?.length ?? 0} agent${(allAgents?.length ?? 0) !== 1 ? "s" : ""}${!isAdmin ? " · read-only" : ""}`}
        actions={isAdmin ? (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            + New agent
          </button>
        ) : undefined}
      />

      {agentsPaused && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-400/40 bg-red-50/5 px-4 py-2.5">
          <span className="text-sm text-text-primary">
            <span className="font-semibold">All agents are paused.</span>{" "}
            <span className="text-text-secondary">No runs will execute until resumed.</span>
          </span>
          {isAdmin && (
            <button
              onClick={handleGlobalPauseToggle}
              className="text-sm rounded-md bg-accent px-3 py-1 font-medium text-white hover:bg-accent-hover"
            >
              Resume all
            </button>
          )}
        </div>
      )}
      {!agentsPaused && isAdmin && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={handleGlobalPauseToggle}
            className="text-xs text-text-tertiary hover:text-text-red"
          >
            Pause all agents
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden grid grid-cols-[380px_1fr] gap-6">
        {/* Left: Org tree */}
        <div className="overflow-y-auto pr-2">
          {treeLoading ? (
            <p className="text-sm text-text-secondary py-8">Loading…</p>
          ) : flat.length === 0 ? (
            <p className="text-sm text-text-secondary py-8">No agents yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {flat.map(({ agent, depth }) => (
                <li key={agent.id}>
                  <button
                    onClick={() => setSelectedId(agent.id)}
                    className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                      selectedId === agent.id ? "bg-bg-hover" : "hover:bg-bg-secondary"
                    }`}
                    style={{ paddingLeft: `${8 + depth * 20}px` }}
                  >
                    {depth > 0 && <span className="text-text-tertiary text-xs">{"\u2514\u2500"}</span>}
                    <span className="w-6 h-6 rounded-full bg-surface-purple text-text-purple flex items-center justify-center text-[10px] font-semibold shrink-0">
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-text-primary truncate">{agent.name}</span>
                      <span className="block text-[11px] text-text-tertiary truncate">{agent.role}</span>
                    </span>
                    <Badge color={STATUS_COLORS[agent.status] ?? "gray"}>{agent.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: Detail panel */}
        <div className="overflow-y-auto">
          {selected ? (
            <AgentDetailPanel
              agent={selected}
              allAgents={allAgents ?? []}
              runtimes={runtimes ?? []}
              isAdmin={isAdmin}
            />
          ) : (
            <p className="text-sm text-text-secondary py-8">Select an agent to view details.</p>
          )}
        </div>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New agent">
        <NewAgentForm
          allAgents={allAgents ?? []}
          runtimes={runtimes ?? []}
          onDone={(newId) => { setShowCreate(false); if (newId) setSelectedId(newId); }}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>
    </div>
  );
}

function NewAgentForm({
  allAgents, runtimes, onDone, onCancel,
}: {
  allAgents: Agent[];
  runtimes: Array<{ id: string; name: string }>;
  onDone: (newId?: string) => void;
  onCancel: () => void;
}) {
  const create = useCreateAgent();
  const [form, setForm] = useState({
    name: "",
    role: "general",
    reportsTo: "",
    runtimeId: runtimes[0]?.id ?? "",
    instructions: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({
        name: form.name,
        role: form.role || "general",
        reportsTo: form.reportsTo || null,
        runtimeId: form.runtimeId || null,
        instructions: form.instructions || undefined,
      });
      onDone((created as any)?.id);
    } catch (e: any) {
      setError(e?.message ?? "Create failed");
    }
  };

  const disabled = create.isPending || !form.name.trim();

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Name</label>
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Role</label>
        <input
          value={form.role}
          onChange={(e) => set("role", e.target.value)}
          placeholder="general"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
        />
        <p className="mt-1 text-[11px] text-text-tertiary">Short identifier (e.g. "vp-sales", "general"). Can't be changed later.</p>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Reports to</label>
        <select
          value={form.reportsTo}
          onChange={(e) => set("reportsTo", e.target.value)}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
        >
          <option value="">None (top-level)</option>
          {allAgents.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Runtime</label>
        <select
          value={form.runtimeId}
          onChange={(e) => set("runtimeId", e.target.value)}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
        >
          <option value="">No runtime (cannot run)</option>
          {runtimes.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Instructions (optional)</label>
        <textarea
          value={form.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="You are a…"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm min-h-[100px] font-mono"
        />
      </div>
      {error && <p className="text-xs text-text-red">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-text-primary hover:bg-bg-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create agent"}
        </button>
      </div>
    </form>
  );
}

function AgentDetailPanel({
  agent, allAgents, runtimes, isAdmin,
}: {
  agent: Agent;
  allAgents: Agent[];
  runtimes: Array<{ id: string; name: string; model?: string | null }>;
  isAdmin: boolean;
}) {
  const update = useUpdateAgent();
  const updateSkills = useUpdateAgentSkills();
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null);
  const [skillsInput, setSkillsInput] = useState("");
  const [reparentError, setReparentError] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);

  const skills = agent.skills ?? [];
  const reports = allAgents.filter((a) => a.reportsTo === agent.id);
  const manager = allAgents.find((a) => a.id === agent.reportsTo);

  const parentOptions = allAgents.filter((a) => a.id !== agent.id && !isDescendant(allAgents, a.id, agent.id));

  const handleReparent = async (newParentId: string | null) => {
    setReparentError(null);
    try {
      await update.mutateAsync({ id: agent.id, reportsTo: newParentId as any });
    } catch (e: any) {
      setReparentError(e?.message ?? "Reparent failed");
    }
  };

  const handleStatusToggle = () => {
    const next = agent.status === "paused" ? "idle" : "paused";
    update.mutate({ id: agent.id, status: next });
  };

  const handleAddSkill = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && skillsInput.trim()) {
      e.preventDefault();
      const next = [...skills, skillsInput.trim()].filter((s, i, a) => a.indexOf(s) === i);
      await updateSkills.mutateAsync({ id: agent.id, set: next });
      setSkillsInput("");
    }
  };

  const handleRemoveSkill = async (s: string) => {
    const next = skills.filter((x) => x !== s);
    await updateSkills.mutateAsync({ id: agent.id, set: next });
  };

  const handleSaveInstructions = async () => {
    if (instructionsDraft === null) return;
    await update.mutateAsync({ id: agent.id, instructions: instructionsDraft });
    setInstructionsDraft(null);
  };

  const handleArchive = async () => {
    if (!confirm(`Archive ${agent.name}? Their ${reports.length} report(s) will move up to ${manager?.name ?? "top-level"}.`)) return;
    await update.mutateAsync({ id: agent.id, status: "archived" });
  };

  const handleRuntimeChange = (runtimeId: string) => {
    update.mutate({ id: agent.id, runtimeId: runtimeId || (null as any) });
  };

  const handleBudgetSave = async () => {
    if (budgetDraft === null) return;
    const cents = Math.max(0, Math.round(parseFloat(budgetDraft || "0") * 100));
    await update.mutateAsync({ id: agent.id, budgetMonthlyCents: cents });
    setBudgetDraft(null);
  };

  const currentRuntime = runtimes.find((r) => r.id === agent.runtimeId);
  const budgetDollars = ((agent.budgetMonthlyCents ?? 0) / 100).toFixed(2);
  const spentDollars = ((agent.spentMonthlyCents ?? 0) / 100).toFixed(2);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm text-text-tertiary">{agent.role}</span>
          {agent.title && <span className="text-sm text-text-secondary">· {agent.title}</span>}
          <Badge color={STATUS_COLORS[agent.status] ?? "gray"}>{agent.status}</Badge>
        </div>
      </div>

      {/* Hierarchy */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Hierarchy</h2>
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Reports to</label>
            <select
              disabled={!isAdmin}
              value={agent.reportsTo ?? ""}
              onChange={(e) => handleReparent(e.target.value || null)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">None (top-level)</option>
              {parentOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
              ))}
            </select>
            {reparentError && <p className="mt-1 text-xs text-text-red">{reparentError}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">
              Direct reports ({reports.length})
            </label>
            {reports.length === 0 ? (
              <p className="text-sm text-text-tertiary">No direct reports</p>
            ) : (
              <ul className="space-y-1">
                {reports.map((r) => (
                  <li key={r.id} className="text-sm text-text-primary">
                    {r.name} <span className="text-text-tertiary">({r.role})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Skills */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Skills</h2>
        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap gap-2 mb-2">
            {skills.length === 0 ? (
              <span className="text-sm text-text-tertiary">No skills yet</span>
            ) : (
              skills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-md bg-surface-blue px-2 py-0.5 text-xs text-text-blue">
                  {s}
                  {isAdmin && (
                    <button
                      onClick={() => handleRemoveSkill(s)}
                      className="text-text-blue/60 hover:text-text-blue ml-1"
                      title="Remove"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))
            )}
          </div>
          {isAdmin && (
            <input
              type="text"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              onKeyDown={handleAddSkill}
              placeholder="Add skill and press Enter"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
          )}
        </div>
      </section>

      {/* Instructions */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Instructions</h2>
        <div className="rounded-lg border border-border p-4">
          {instructionsDraft !== null ? (
            <>
              <textarea
                value={instructionsDraft}
                onChange={(e) => setInstructionsDraft(e.target.value)}
                className="w-full min-h-[200px] rounded-md border border-border bg-bg px-3 py-2 text-sm font-mono"
              />
              <div className="mt-2 flex gap-2 justify-end">
                <button onClick={() => setInstructionsDraft(null)} className="text-sm px-3 py-1 rounded border border-border">
                  Cancel
                </button>
                <button onClick={handleSaveInstructions} className="text-sm px-3 py-1 rounded bg-accent text-white">
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              <pre className="whitespace-pre-wrap text-sm text-text-primary font-mono max-h-[200px] overflow-y-auto">
                {agent.instructions || <span className="text-text-tertiary italic">No instructions set</span>}
              </pre>
              {isAdmin && (
                <button
                  onClick={() => setInstructionsDraft(agent.instructions ?? "")}
                  className="mt-2 text-xs text-accent hover:underline"
                >
                  Edit instructions
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* Runtime & budget */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Runtime & budget</h2>
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Runtime</label>
            <select
              disabled={!isAdmin}
              value={agent.runtimeId ?? ""}
              onChange={(e) => handleRuntimeChange(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">No runtime (cannot run)</option>
              {runtimes.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.model ? ` · ${r.model}` : ""}</option>
              ))}
            </select>
            {currentRuntime && (
              <p className="mt-1 text-[11px] text-text-tertiary">Model: {currentRuntime.model ?? "default"}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Monthly budget (USD)</label>
            {budgetDraft !== null ? (
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                  className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm"
                  autoFocus
                />
                <button
                  onClick={handleBudgetSave}
                  className="text-sm px-3 py-1 rounded bg-accent text-white"
                >
                  Save
                </button>
                <button
                  onClick={() => setBudgetDraft(null)}
                  className="text-sm px-3 py-1 rounded border border-border"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-sm text-text-primary">
                  {(agent.budgetMonthlyCents ?? 0) === 0 ? (
                    <span className="text-text-tertiary">Unlimited</span>
                  ) : (
                    <>${budgetDollars} <span className="text-text-tertiary">· spent ${spentDollars} this month</span></>
                  )}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => setBudgetDraft(budgetDollars)}
                    className="text-xs text-accent hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Status controls */}
      {isAdmin && agent.status !== "archived" && (
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">Danger zone</h2>
          <div className="rounded-lg border border-border p-4 flex gap-2">
            <button
              onClick={handleStatusToggle}
              className="text-sm px-3 py-1 rounded border border-border hover:bg-bg-hover"
            >
              {agent.status === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              onClick={handleArchive}
              className="text-sm px-3 py-1 rounded border border-border text-text-red hover:bg-surface-red"
            >
              Archive
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// Prevent setting a parent that would create a cycle (server also enforces).
function isDescendant(all: Agent[], possibleDescendant: string, ancestor: string): boolean {
  let cursor: string | null | undefined = possibleDescendant;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor === ancestor) return true;
    const next: Agent | undefined = all.find((a) => a.id === cursor);
    cursor = next?.reportsTo;
  }
  return false;
}
