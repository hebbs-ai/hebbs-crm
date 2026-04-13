import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";

interface TenantInfo {
  tenantId: string;
  tenantName: string;
  role: string;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string;
  role: string;
  tenants: TenantInfo[];
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (opts: { name: string; email: string; password: string; orgName?: string; inviteCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_BASE = "/api/crm/auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [activeTenantId, setActiveTenantId] = useState<string | null>(() => localStorage.getItem("tenantId"));
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async (t: string, tenantId?: string | null) => {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${t}` };
      if (tenantId) headers["X-Tenant-Id"] = tenantId;

      const res = await fetch(`${AUTH_BASE}/me`, { headers });
      if (!res.ok) throw new Error("Invalid session");
      const data = await res.json();
      setUser(data);
      if (data.tenantId) {
        localStorage.setItem("tenantId", data.tenantId);
        setActiveTenantId(data.tenantId);
      }
    } catch {
      localStorage.removeItem("token");
      localStorage.removeItem("tenantId");
      setToken(null);
      setActiveTenantId(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchMe(token, activeTenantId).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token, fetchMe, activeTenantId]);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Login failed");
    }
    const data = await res.json();
    localStorage.setItem("token", data.token);
    setToken(data.token);
    await fetchMe(data.token);
  };

  const signup = async (opts: { name: string; email: string; password: string; orgName?: string; inviteCode?: string }) => {
    const res = await fetch(`${AUTH_BASE}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Signup failed");
    }
    const data = await res.json();
    localStorage.setItem("token", data.token);
    setToken(data.token);
    await fetchMe(data.token);
  };

  const logout = async () => {
    if (token) {
      await fetch(`${AUTH_BASE}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem("token");
    localStorage.removeItem("tenantId");
    setToken(null);
    setActiveTenantId(null);
    setUser(null);
  };

  const switchTenant = async (tenantId: string) => {
    localStorage.setItem("tenantId", tenantId);
    setActiveTenantId(tenantId);
    if (token) await fetchMe(token, tenantId);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout, switchTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
