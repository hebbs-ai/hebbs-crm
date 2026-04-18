import { useState } from "react";
import { useAgents, isUserFacingAgent, type Agent } from "../hooks/useAgents";
import { useTeamUsers } from "../hooks/useTeam";

export type AssigneeValue =
  | { kind: "unassigned" }
  | { kind: "user"; userId: string }
  | { kind: "agent"; agentId: string };

const serialize = (v: AssigneeValue): string => {
  if (v.kind === "unassigned") return "unassigned";
  if (v.kind === "user") return `user:${v.userId}`;
  return `agent:${v.agentId}`;
};

const parse = (s: string): AssigneeValue => {
  if (s === "unassigned" || !s) return { kind: "unassigned" };
  if (s.startsWith("user:")) return { kind: "user", userId: s.slice(5) };
  if (s.startsWith("agent:")) return { kind: "agent", agentId: s.slice(6) };
  return { kind: "unassigned" };
};

const labelClass = "mb-1 block text-xs font-medium uppercase tracking-wide text-text-tertiary";
const inputClass = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";

interface Props {
  label?: string;
  value: AssigneeValue;
  onChange: (v: AssigneeValue) => void;
  className?: string;
  allowSystemAgents?: boolean;
}

export function AssigneePicker({ label = "Assignee", value, onChange, className = "", allowSystemAgents = false }: Props) {
  const [showSystem, setShowSystem] = useState(allowSystemAgents);
  const { data: agents } = useAgents();
  const { data: usersResp } = useTeamUsers();
  const users = usersResp?.data ?? [];

  const visibleAgents: Agent[] = (agents ?? []).filter((a) => showSystem || isUserFacingAgent(a) || a.role === "copilot");

  return (
    <div className={className}>
      {label && <label className={labelClass}>{label}</label>}
      <select
        className={inputClass}
        value={serialize(value)}
        onChange={(e) => onChange(parse(e.target.value))}
      >
        <option value="unassigned">Unassigned</option>
        {users.length > 0 && (
          <optgroup label="People">
            {users.map((u) => (
              <option key={u.userId} value={`user:${u.userId}`}>{u.name || u.email}</option>
            ))}
          </optgroup>
        )}
        {visibleAgents.length > 0 && (
          <optgroup label="Agents">
            {visibleAgents.map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>{a.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      {!allowSystemAgents && (agents ?? []).some((a) => !isUserFacingAgent(a) && a.role !== "copilot") && (
        <button
          type="button"
          onClick={() => setShowSystem((s) => !s)}
          className="mt-1 text-[11px] text-text-tertiary hover:text-text-secondary"
        >
          {showSystem ? "Hide" : "Show"} system agents
        </button>
      )}
    </div>
  );
}
