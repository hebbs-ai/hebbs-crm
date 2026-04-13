import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";

const NAV_ITEMS = [
  { to: "/brief", label: "Morning Brief", icon: "\u2600" },
  { to: "/pipeline", label: "Pipeline", icon: "\u25B7" },
  { to: "/deals", label: "Deals", icon: "\u2300" },
  { to: "/contacts", label: "Contacts", icon: "\u2636" },
  { to: "/companies", label: "Companies", icon: "\u2302" },
  { to: "/tasks", label: "Tasks", icon: "\u2611" },
  { to: "/copilot", label: "Copilot", icon: "\u25C7" },
];

const TOOL_ITEMS = [
  { to: "/settings/team", label: "Settings", icon: "\u2699" },
];

export function Sidebar() {
  const { user, logout, switchTenant } = useAuth();
  const [showTenantMenu, setShowTenantMenu] = useState(false);

  const hasMultipleTenants = (user?.tenants?.length ?? 0) > 1;

  return (
    <aside className="w-[248px] bg-bg-secondary border-r border-border p-2 flex flex-col shrink-0 overflow-y-auto">
      {/* Tenant header */}
      <div className="px-2 pb-3 relative">
        <button
          onClick={() => hasMultipleTenants && setShowTenantMenu(!showTenantMenu)}
          className={`flex items-center gap-2 w-full text-left rounded-md px-1 py-1 ${hasMultipleTenants ? "hover:bg-bg-hover cursor-pointer" : ""}`}
        >
          <span className="text-lg">{"\u25C9"}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">{user?.tenantName ?? "BoringOS CRM"}</h2>
          </div>
          {hasMultipleTenants && <span className="text-[10px] text-text-tertiary">{"\u25BC"}</span>}
        </button>

        {showTenantMenu && user?.tenants && (
          <div className="absolute left-2 right-2 top-full mt-1 rounded-md border border-border bg-bg shadow-md z-50">
            {user.tenants.map((t) => (
              <button
                key={t.tenantId}
                onClick={() => { switchTenant(t.tenantId); setShowTenantMenu(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors ${t.tenantId === user.tenantId ? "font-medium text-accent" : "text-text-secondary"}`}
              >
                {t.tenantName}
                <span className="ml-2 text-xs text-text-tertiary">{t.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="flex flex-col gap-0.5 flex-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-bg-hover text-text-primary font-medium"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`
            }
          >
            <span className="w-[18px] text-center text-[15px] shrink-0">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}

        <div className="mt-4 mb-1 px-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Settings</div>
        </div>
        {TOOL_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-bg-hover text-text-primary font-medium"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`
            }
          >
            <span className="w-[18px] text-center text-[15px] shrink-0">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div className="mt-auto border-t border-border pt-3 px-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-surface-purple text-text-purple flex items-center justify-center text-xs font-semibold shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary truncate">{user.name}</div>
              <div className="text-xs text-text-tertiary truncate">{user.email}</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-2 w-full text-left px-2 py-1 rounded text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
