import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useTeamUsers, useInvitations, useInviteUser, useUpdateUserRole, useRemoveUser, useRevokeInvitation } from "../hooks/useTeam";
import { Modal } from "../components/ui/Modal";
import { Input, Select } from "../components/ui/FormField";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";

export function SettingsPage() {
  const { user } = useAuth();
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
