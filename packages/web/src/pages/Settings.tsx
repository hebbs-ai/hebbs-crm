import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTeamUsers, useInvitations, useInviteUser, useUpdateUserRole, useRemoveUser, useRevokeInvitation } from "../hooks/useTeam";
import { useConnectorStatus, useDisconnectConnector } from "../hooks/useConnectors";
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

// CompanyProfileTab was removed — business profile now lives in the
// framework shell (Settings → Business profile). The CRM dev SPA no
// longer renders its own profile editor.

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

// --- Main Settings Page ---

type TabKey = "team" | "connectors" | "runtimes";

const TABS: { key: TabKey; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "connectors", label: "Connectors" },
  { key: "runtimes", label: "Runtimes" },
];

export function SettingsPage() {
  const { user } = useAuth();
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab: TabKey = (TABS.find((t) => t.key === tab)?.key) ?? (searchParams.has("connected") ? "connectors" : "team");
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

      {activeTab === "connectors" && <ConnectorsTab />}
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
