import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTeamUsers, useInvitations, useInviteUser, useUpdateUserRole, useRemoveUser, useRevokeInvitation } from "../hooks/useTeam";
import { useConnectorStatus, useDisconnectConnector } from "../hooks/useConnectors";
import { useMemoryConfig, useSaveMemoryConfig, useRemoveMemoryConfig } from "../hooks/useMemory";
import { useCompanyProfile, useSaveCompanyProfile } from "../hooks/useProfile";
import { Modal } from "../components/ui/Modal";
import { Input, Textarea, Select } from "../components/ui/FormField";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";

const CONNECTOR_ICONS: Record<string, string> = {
  google: "\uD83D\uDCE7",
  slack: "\uD83D\uDCAC",
  github: "\uD83D\uDC19",
};

// --- Framework API helpers ---

function frameworkHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function adminFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, { headers: frameworkHeaders(), ...opts });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// --- Hooks for framework data (agents, runtimes, settings) ---

function useFrameworkAgents() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch<{ agents: any[] }>("/agents");
      setAgents(res.agents);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { agents, loading, refresh };
}

function useFrameworkRuntimes() {
  const [runtimes, setRuntimes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch<{ runtimes: any[] }>("/runtimes");
      setRuntimes(res.runtimes);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { runtimes, loading, refresh };
}

function useFrameworkSettings() {
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch<{ settings: Record<string, string | null> }>("/settings");
      setSettings(res.settings);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { settings, loading, refresh };
}

function useRuntimeModels(runtimeId: string | undefined) {
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!runtimeId) return;
    adminFetch<{ models: { id: string; label: string }[] }>(`/runtimes/${runtimeId}/models`)
      .then((res) => setModels(res.models))
      .catch(() => {});
  }, [runtimeId]);
  return models;
}

// --- Company Profile Tab ---

const PROFILE_FIELDS: {
  key: string;
  label: string;
  type: "input" | "textarea";
  rows?: number;
  help: string;
}[] = [
  { key: "company_name", label: "Company Name", type: "input", help: "" },
  { key: "company_description", label: "What We Do", type: "textarea", rows: 3, help: "Describe your business in 1-2 sentences" },
  { key: "company_products", label: "Products & Services", type: "textarea", rows: 3, help: "List your main products/services, one per line" },
  { key: "company_icp", label: "Ideal Customer", type: "textarea", rows: 2, help: "Who is your target buyer? Industry, size, role" },
  { key: "company_differentiators", label: "Key Differentiators", type: "textarea", rows: 3, help: "What makes you different from competitors?" },
  { key: "company_competitors", label: "Competitors", type: "input", help: "List main competitors, comma separated" },
  { key: "company_methodology", label: "Sales Methodology", type: "textarea", rows: 2, help: "How do you sell? E.g., consultative, demo-first, PLG" },
  { key: "company_tone", label: "Tone & Voice", type: "textarea", rows: 2, help: "How should AI agents communicate? E.g., professional but casual" },
];

function CompanyProfileTab() {
  const { data, isLoading } = useCompanyProfile();
  const saveProfile = useSaveCompanyProfile();
  const [form, setForm] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data?.profile && !initialized) {
      const initial: Record<string, string> = {};
      for (const f of PROFILE_FIELDS) {
        initial[f.key] = data.profile[f.key as keyof typeof data.profile] ?? "";
      }
      setForm(initial);
      setInitialized(true);
    }
  }, [data, initialized]);

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveProfile.mutateAsync(form);
      setSuccessMsg("Company profile saved successfully.");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch {
      // error handled by mutation state
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading company profile...</p>;
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-text-secondary mb-6">
        Tell your AI agents about your business. This context guides how they analyze emails, draft follow-ups, and prepare for meetings.
      </p>

      {successMsg && (
        <div className="mb-4 rounded-md bg-surface-green px-4 py-2 text-sm text-text-green">
          {successMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {PROFILE_FIELDS.map((field) => (
          <div key={field.key}>
            {field.type === "input" ? (
              <Input
                label={field.label}
                value={form[field.key] ?? ""}
                onChange={(e) => handleChange(field.key, (e.target as HTMLInputElement).value)}
              />
            ) : (
              <Textarea
                label={field.label}
                rows={field.rows}
                value={form[field.key] ?? ""}
                onChange={(e) => handleChange(field.key, (e.target as HTMLTextAreaElement).value)}
              />
            )}
            {field.help && (
              <p className="mt-1 text-xs text-text-tertiary">{field.help}</p>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={saveProfile.isPending}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {saveProfile.isPending ? "Saving..." : "Save Profile"}
        </button>
      </form>
    </div>
  );
}

function ConnectorsTab() {
  const { user } = useAuth();
  const { data, isLoading } = useConnectorStatus();
  const disconnect = useDisconnectConnector();
  const [searchParams, setSearchParams] = useSearchParams();
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected) {
      setSuccessBanner(`${connected} connected successfully!`);
      searchParams.delete("connected");
      setSearchParams(searchParams, { replace: true });
      const timer = setTimeout(() => setSuccessBanner(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, setSearchParams]);

  const connectors = data?.connectors ?? [];
  const tenantId = user?.tenantId;

  const handleConnect = (kind: string) => {
    // OAuth must go through the public API URL (not frontend proxy) so redirect_uri is correct
    const apiBase = window.location.origin.replace("crm.", "crmapi.");
    window.location.href = `${apiBase}/api/connectors/oauth/${kind}/authorize?tenantId=${tenantId}`;
  };

  const handleDisconnect = async (kind: string) => {
    if (confirm(`Disconnect ${kind}?`)) {
      await disconnect.mutateAsync(kind);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading connectors...</p>;
  }

  return (
    <div>
      {successBanner && (
        <div className="mb-4 rounded-md bg-surface-green px-4 py-2 text-sm text-text-green">
          {successBanner}
        </div>
      )}

      {connectors.length === 0 ? (
        <p className="text-sm text-text-secondary">No connectors available.</p>
      ) : (
        <div className="grid gap-4">
          {connectors.map((c) => (
            <div
              key={c.kind}
              className="rounded-lg border border-border p-4 hover:bg-bg-secondary transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl w-10 h-10 flex items-center justify-center rounded-lg bg-bg-secondary">
                  {CONNECTOR_ICONS[c.kind] ?? "\u26A1"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">{c.name}</span>
                    <Badge color={c.connected ? "green" : "gray"}>
                      {c.connected ? "Connected" : "Not connected"}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">{c.description}</p>
                  {c.connected && c.lastSyncAt && (
                    <p className="text-xs text-text-tertiary mt-1">
                      Last synced: {new Date(c.lastSyncAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div>
                  {c.connected ? (
                    <button
                      onClick={() => handleDisconnect(c.kind)}
                      disabled={disconnect.isPending}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-red transition-colors disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  ) : c.hasOAuth ? (
                    <button
                      onClick={() => handleConnect(c.kind)}
                      className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
                    >
                      Connect
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Agents Tab ---

function AgentsTab() {
  const { agents, loading, refresh } = useFrameworkAgents();
  const { runtimes } = useFrameworkRuntimes();
  const { settings, refresh: refreshSettings } = useFrameworkSettings();

  const agentsPaused = settings.agents_paused === "true";

  const handleGlobalPause = async () => {
    await adminFetch("/settings", {
      method: "PATCH",
      body: JSON.stringify({ agents_paused: agentsPaused ? "false" : "true" }),
    });
    refreshSettings();
  };

  const handleToggleAgent = async (agentId: string, currentStatus: string) => {
    const newStatus = currentStatus === "paused" ? "idle" : "paused";
    await adminFetch(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus }),
    });
    refresh();
  };

  const runtimeMap = new Map(runtimes.map((r: any) => [r.id, r]));

  if (loading) return <p className="text-sm text-text-secondary">Loading agents...</p>;

  return (
    <div>
      {/* Global pause banner */}
      <div className={`mb-6 flex items-center justify-between rounded-lg border p-4 ${
        agentsPaused ? "border-red-400/40 bg-red-50/5" : "border-border bg-bg-secondary"
      }`}>
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {agentsPaused ? "All agents are paused" : "Agents are active"}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            {agentsPaused
              ? "No agent runs will execute until unpaused. Pending wakeups are held."
              : "Agents will execute normally when triggered."}
          </div>
        </div>
        <button
          onClick={handleGlobalPause}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            agentsPaused
              ? "bg-accent text-white hover:bg-accent-hover"
              : "border border-red-400/40 text-text-red hover:bg-red-50/10"
          }`}
        >
          {agentsPaused ? "Resume All" : "Pause All"}
        </button>
      </div>

      {/* Agent list */}
      {agents.length === 0 ? (
        <p className="text-sm text-text-secondary">No agents configured.</p>
      ) : (
        <div className="rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_120px_160px_100px_80px] gap-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary border-b border-border">
            <span>Agent</span>
            <span>Role</span>
            <span>Runtime / Model</span>
            <span>Status</span>
            <span></span>
          </div>
          {agents.map((agent: any) => {
            const rt = runtimeMap.get(agent.runtimeId);
            return (
              <div key={agent.id} className="grid grid-cols-[1fr_120px_160px_100px_80px] gap-4 px-4 py-3 border-b border-border last:border-b-0 items-center hover:bg-bg-secondary transition-colors">
                <div>
                  <div className="text-sm font-medium text-text-primary">{agent.name}</div>
                  {agent.title && <div className="text-xs text-text-tertiary">{agent.title}</div>}
                </div>
                <div className="text-xs text-text-secondary">{agent.role}</div>
                <div>
                  <div className="text-xs text-text-primary">{rt?.name ?? "—"}</div>
                  <div className="text-[11px] text-text-tertiary">{rt?.model ?? "default"}</div>
                </div>
                <Badge color={
                  agent.status === "paused" ? "orange" :
                  agent.status === "running" ? "blue" :
                  agent.status === "error" ? "red" : "gray"
                }>
                  {agent.status}
                </Badge>
                <button
                  onClick={() => handleToggleAgent(agent.id, agent.status)}
                  className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  {agent.status === "paused" ? "Resume" : "Pause"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Runtimes Tab ---

function RuntimesTab() {
  const { runtimes, loading, refresh } = useFrameworkRuntimes();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (loading) return <p className="text-sm text-text-secondary">Loading runtimes...</p>;

  return (
    <div>
      {runtimes.length === 0 ? (
        <p className="text-sm text-text-secondary">No runtimes configured.</p>
      ) : (
        <div className="grid gap-4">
          {runtimes.map((rt: any) => (
            <RuntimeCard
              key={rt.id}
              runtime={rt}
              isEditing={editingId === rt.id}
              onEdit={() => setEditingId(editingId === rt.id ? null : rt.id)}
              onSave={async (model: string) => {
                await adminFetch(`/runtimes/${rt.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ model }),
                });
                setEditingId(null);
                refresh();
              }}
              onSetDefault={async () => {
                await adminFetch(`/runtimes/${rt.id}/default`, { method: "POST" });
                refresh();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RuntimeCard({ runtime: rt, isEditing, onEdit, onSave, onSetDefault }: {
  runtime: any;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (model: string) => Promise<void>;
  onSetDefault: () => Promise<void>;
}) {
  const models = useRuntimeModels(isEditing ? rt.id : undefined);
  const [selectedModel, setSelectedModel] = useState(rt.model ?? "");

  useEffect(() => { setSelectedModel(rt.model ?? ""); }, [rt.model]);

  return (
    <div className="rounded-lg border border-border p-4 hover:bg-bg-secondary/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">{rt.name}</span>
            <Badge color="gray">{rt.type}</Badge>
            {rt.isDefault && <Badge color="blue">Default</Badge>}
            <Badge color={rt.status === "active" || rt.status === "healthy" ? "green" : "gray"}>
              {rt.status}
            </Badge>
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            Model: {rt.model ?? "CLI default"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!rt.isDefault && (
            <button onClick={onSetDefault} className="text-xs text-text-secondary hover:text-text-primary transition-colors">
              Set Default
            </button>
          )}
          <button onClick={onEdit} className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover transition-colors">
            {isEditing ? "Cancel" : "Change Model"}
          </button>
        </div>
      </div>
      {isEditing && (
        <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border">
          {models.length > 0 ? (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            >
              <option value="">CLI default</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label} ({m.id})</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="Model ID (e.g., claude-sonnet-4-6)"
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          )}
          <button
            onClick={() => onSave(selectedModel)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// --- Memory Tab ---

function MemoryTab() {
  const { data, isLoading } = useMemoryConfig();
  const saveConfig = useSaveMemoryConfig();
  const removeConfig = useRemoveMemoryConfig();
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const configured = data?.configured ?? false;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await saveConfig.mutateAsync({ endpoint, apiKey });
      setEndpoint("");
      setApiKey("");
    } catch (err: any) {
      setError(err.message ?? "Failed to connect");
    }
  };

  const handleDisconnect = async () => {
    if (confirm("Disconnect memory? This will remove your Hebbs credentials.")) {
      await removeConfig.mutateAsync();
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading memory configuration...</p>;
  }

  if (configured) {
    return (
      <div>
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge color="green">Memory active</Badge>
              <span className="text-sm text-text-secondary">{data?.endpoint}</span>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={removeConfig.isPending}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-red transition-colors disabled:opacity-50"
            >
              {removeConfig.isPending ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <Link
            to="/knowledge"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Open Knowledge Base
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-lg border border-border p-6 max-w-lg">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Memory not configured</h3>
        <p className="text-sm text-text-secondary mb-4">
          Enter your Hebbs credentials to enable memory and knowledge base.
        </p>

        {error && (
          <div className="mb-4 rounded-md bg-surface-red px-4 py-2 text-sm text-text-red">
            {error}
          </div>
        )}

        <form onSubmit={handleConnect}>
          <div className="mb-3">
            <label className="block text-sm font-medium text-text-primary mb-1">Endpoint URL</label>
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              required
              placeholder="https://your-instance.hebbs.ai"
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              placeholder="hb_..."
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>
          <button
            type="submit"
            disabled={saveConfig.isPending}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saveConfig.isPending ? "Connecting..." : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- Main Settings Page ---

type TabKey = "profile" | "team" | "connectors" | "agents" | "runtimes" | "memory";

const TABS: { key: TabKey; label: string }[] = [
  { key: "profile", label: "Company Profile" },
  { key: "team", label: "Team" },
  { key: "connectors", label: "Connectors" },
  { key: "memory", label: "Memory" },
  { key: "agents", label: "Agents" },
  { key: "runtimes", label: "Runtimes" },
];

export function SettingsPage() {
  const { user } = useAuth();
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab: TabKey = (TABS.find((t) => t.key === tab)?.key) ?? (searchParams.has("connected") ? "connectors" : "profile");
  const { data: usersData, isLoading: usersLoading } = useTeamUsers();
  const { data: invitesData } = useInvitations();
  const inviteUser = useInviteUser();
  const updateRole = useUpdateUserRole();
  const removeUser = useRemoveUser();
  const revokeInvite = useRevokeInvitation();

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const users = usersData?.data ?? [];
  const invites = invitesData?.data ?? [];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await inviteUser.mutateAsync({ email: inviteEmail, role: inviteRole });
      setInviteLink(window.location.origin + result.inviteLink);
      setInviteEmail("");
    } catch {
      // error shown via mutation state
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Settings"
        subtitle={`${user?.tenantName ?? "Your organization"}`}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => navigate(`/settings/${t.key}`, { replace: true })}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === t.key
                ? "border-accent text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && <CompanyProfileTab />}
      {activeTab === "connectors" && <ConnectorsTab />}
      {activeTab === "memory" && <MemoryTab />}
      {activeTab === "agents" && <AgentsTab />}
      {activeTab === "runtimes" && <RuntimesTab />}

      {activeTab === "team" && <>
      {/* Team Members */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Team Members</h2>
          {isAdmin && (
            <button
              onClick={() => { setShowInvite(true); setInviteLink(null); }}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              + Invite Member
            </button>
          )}
        </div>

        {usersLoading ? (
          <p className="text-sm text-text-secondary">Loading...</p>
        ) : (
          <div className="rounded-lg border border-border">
            {users.map((u) => (
              <div key={u.userId} className="flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-bg-secondary transition-colors">
                <div className="w-8 h-8 rounded-full bg-surface-purple text-text-purple flex items-center justify-center text-xs font-semibold shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary">
                    {u.name}
                    {u.userId === user?.id && <span className="ml-2 text-xs text-text-tertiary">(you)</span>}
                  </div>
                  <div className="text-xs text-text-secondary">{u.email}</div>
                </div>
                <div className="flex items-center gap-3">
                  {isAdmin && u.userId !== user?.id ? (
                    <select
                      value={u.role}
                      onChange={(e) => updateRole.mutate({ userId: u.userId, role: e.target.value })}
                      className="rounded border border-border bg-bg px-2 py-1 text-xs text-text-primary"
                    >
                      <option value="admin">Admin</option>
                      <option value="staff">Staff</option>
                    </select>
                  ) : (
                    <Badge color={u.role === "admin" ? "blue" : "gray"}>{u.role}</Badge>
                  )}
                  {isAdmin && u.userId !== user?.id && (
                    <button
                      onClick={() => { if (confirm(`Remove ${u.name} from the team?`)) removeUser.mutate(u.userId); }}
                      className="text-xs text-text-tertiary hover:text-text-red transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending Invitations */}
      {isAdmin && invites.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold mb-4">Pending Invitations</h2>
          <div className="rounded-lg border border-border">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center px-4 py-3 border-b border-border last:border-b-0">
                <div className="flex-1">
                  <div className="text-sm text-text-primary">{inv.email}</div>
                  <div className="text-xs text-text-tertiary">
                    Expires {new Date(inv.expiresAt).toLocaleDateString()} &middot; <Badge color="gray">{inv.role}</Badge>
                  </div>
                </div>
                <button
                  onClick={() => revokeInvite.mutate(inv.id)}
                  className="text-xs text-text-tertiary hover:text-text-red transition-colors"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      </>}

      {/* Invite Modal */}
      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Invite Team Member">
        {inviteLink ? (
          <div>
            <p className="text-sm text-text-secondary mb-3">Invitation created! Share this link:</p>
            <div className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary font-mono break-all">
              {inviteLink}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => { navigator.clipboard.writeText(inviteLink); }}
                className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors mr-2"
              >
                Copy Link
              </button>
              <button
                onClick={() => setShowInvite(false)}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleInvite}>
            <Input label="Email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail((e.target as HTMLInputElement).value)} required placeholder="colleague@company.com" />
            <Select
              label="Role"
              value={inviteRole}
              onChange={(e) => setInviteRole((e.target as HTMLSelectElement).value)}
              options={[{ value: "staff", label: "Staff" }, { value: "admin", label: "Admin" }]}
              className="mt-3"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowInvite(false)} className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={inviteUser.isPending} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
                {inviteUser.isPending ? "Sending..." : "Send Invite"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
