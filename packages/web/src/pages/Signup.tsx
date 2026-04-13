import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get("invite") ?? "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isInvite = !!inviteCode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup({
        name,
        email,
        password,
        ...(isInvite ? { inviteCode } : { orgName: orgName || undefined }),
      });
      navigate("/brief");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-secondary">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">BoringOS CRM</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {isInvite ? "Join your team" : "Create your organization"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-bg p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-md bg-surface-red px-3 py-2 text-sm text-text-red">{error}</div>
          )}

          {isInvite && (
            <div className="mb-4 rounded-md bg-surface-blue px-3 py-2 text-sm text-text-blue">
              You've been invited to join a team. Sign up to accept.
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-tertiary">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Your name" required />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-tertiary">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@company.com" required />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-tertiary">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="Choose a password" required minLength={6} />
          </div>

          {!isInvite && (
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-tertiary">Organization Name</label>
              <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} className={inputClass} placeholder="Acme Corp" />
              <p className="mt-1 text-xs text-text-tertiary">Leave blank to use your name</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50">
            {loading ? "Creating account..." : isInvite ? "Join team" : "Create organization"}
          </button>

          <p className="mt-4 text-center text-sm text-text-secondary">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
