import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTask, useUpdateTask, usePostComment, useAssignTask, useHandoffTask } from "../hooks/useTasks";
import { useAgents } from "../hooks/useAgents";
import { useTeamUsers } from "../hooks/useTeam";
import { PropertyRow } from "../components/ui/PropertyRow";
import { Badge } from "../components/ui/Badge";
import { AssigneePicker, type AssigneeValue } from "../components/AssigneePicker";

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const PRIORITY_COLORS: Record<string, "red" | "orange" | "yellow" | "gray"> = {
  urgent: "red",
  high: "orange",
  medium: "yellow",
  low: "gray",
};

const STATUS_COLORS: Record<string, "gray" | "blue" | "green" | "red"> = {
  todo: "gray",
  in_progress: "blue",
  done: "green",
  blocked: "red",
};

function formatStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useTask(id);
  const updateTask = useUpdateTask();
  const assignTask = useAssignTask();
  const handoffTask = useHandoffTask();
  const postComment = usePostComment();
  const { data: agents } = useAgents();
  const { data: usersResp } = useTeamUsers();
  const [commentBody, setCommentBody] = useState("");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState<string>("");
  const [handoffMsg, setHandoffMsg] = useState("");
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const task = data?.data;
  const comments = (task as any)?.comments ?? [];
  const workProducts = (task as any)?.workProducts ?? [];
  const runs = (task as any)?.runs ?? [];
  const costSummary = (task as any)?.costSummary;

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;
  if (!task) return <div className="p-8 text-sm text-text-secondary">Task not found</div>;

  const handleStatusChange = (newStatus: string) => {
    updateTask.mutate({ id: task.id, status: newStatus });
  };

  const currentAssignee: AssigneeValue = task.assigneeAgentId
    ? { kind: "agent", agentId: task.assigneeAgentId }
    : task.assigneeUserId
    ? { kind: "user", userId: task.assigneeUserId }
    : { kind: "unassigned" };

  const isTerminal = task.status === "done" || task.status === "cancelled";

  const sameAssignee = (a: AssigneeValue, b: AssigneeValue) => {
    if (a.kind !== b.kind) return false;
    if (a.kind === "agent" && b.kind === "agent") return a.agentId === b.agentId;
    if (a.kind === "user" && b.kind === "user") return a.userId === b.userId;
    return true;
  };

  const handleHandoff = async () => {
    if (!handoffTarget) return;
    setHandoffError(null);
    try {
      const res = await handoffTask.mutateAsync({
        taskId: task.id,
        toAgentId: handoffTarget,
        message: handoffMsg || undefined,
        wake: true,
      });
      if ((res as any)?.error) {
        setHandoffError((res as any).error);
        return;
      }
      setHandoffOpen(false);
      setHandoffTarget("");
      setHandoffMsg("");
    } catch (e: any) {
      setHandoffError(e?.message ?? "Handoff failed");
    }
  };

  const handleAssigneeChange = async (next: AssigneeValue) => {
    if (sameAssignee(next, currentAssignee)) return;
    if (next.kind === "agent") {
      await assignTask.mutateAsync({ taskId: task.id, agentId: next.agentId, wake: !isTerminal });
      return;
    }
    await updateTask.mutateAsync({
      id: task.id,
      assigneeAgentId: null as any,
      assigneeUserId: (next.kind === "user" ? next.userId : null) as any,
    });
  };

  const handlePostComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    postComment.mutate(
      { taskId: task.id, body: commentBody },
      { onSuccess: () => setCommentBody("") },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <div className="mb-2">
        <Link to="/tasks" className="text-sm text-text-secondary hover:text-text-primary">
          {"\u2190"} Tasks
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-[30px] font-bold tracking-tight leading-tight">{task.title}</h1>
        <div className="mt-2 flex items-center gap-2">
          {(task as any).identifier && (
            <span className="text-sm text-text-tertiary font-mono">{(task as any).identifier}</span>
          )}
          <Badge color={STATUS_COLORS[task.status] ?? "gray"}>
            {formatStatus(task.status)}
          </Badge>
          {task.priority && (
            <Badge color={PRIORITY_COLORS[task.priority] ?? "gray"}>
              {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
            </Badge>
          )}
          {costSummary?.models?.length > 0 && (
            <Badge color="purple">{costSummary.models.join(", ")}</Badge>
          )}
          {costSummary?.totalCostUsd > 0 && (
            <span className="text-xs text-text-secondary px-2 py-0.5 rounded-full bg-bg-secondary border border-border">
              {formatCost(costSummary.totalCostUsd)} &middot; {formatTokens(costSummary.totalInputTokens + costSummary.totalOutputTokens)} tokens &middot; {costSummary.runCount} run{costSummary.runCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {task.description && (
          <p className="mt-3 text-sm text-text-secondary leading-relaxed">{task.description}</p>
        )}
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-8">
        {/* Left: Comments */}
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
            Comments
          </h2>

          {comments.length === 0 ? (
            <p className="text-sm text-text-tertiary py-4">No comments yet</p>
          ) : (
            <div className="space-y-3 mb-6">
              {comments.map((c: any) => {
                const isAgent = !!c.authorAgentId;
                return (
                  <div
                    key={c.id}
                    className={`rounded-lg p-3 text-sm ${
                      isAgent
                        ? "border-l-3 border-accent bg-bg-secondary"
                        : "border border-border bg-bg"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-text-primary text-xs">
                        {isAgent ? "Agent" : c.authorUserId ?? "User"}
                      </span>
                      {isAgent && (
                        <Badge color="purple">Agent</Badge>
                      )}
                      <span className="text-[11px] text-text-tertiary ml-auto">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-text-primary copilot-markdown">
                      <Markdown remarkPlugins={[remarkGfm]}>{c.body}</Markdown>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Handoff section */}
          <div className="mt-6 border-t border-border pt-4">
            {!handoffOpen ? (
              <button
                onClick={() => setHandoffOpen(true)}
                className="text-sm text-accent hover:underline"
              >
                {"\u2192"} Handoff to another agent
              </button>
            ) : (
              <div className="rounded-lg border border-border p-3 bg-bg-secondary">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Handoff to</label>
                <select
                  value={handoffTarget}
                  onChange={(e) => setHandoffTarget(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
                >
                  <option value="">Select an agent…</option>
                  {(agents ?? []).filter((a) => a.id !== task.assigneeAgentId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                  ))}
                </select>
                <textarea
                  value={handoffMsg}
                  onChange={(e) => setHandoffMsg(e.target.value)}
                  placeholder="Short message explaining the handoff (optional)"
                  className="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm min-h-[60px]"
                />
                {handoffError && <p className="mt-1 text-xs text-text-red">{handoffError}</p>}
                <div className="mt-2 flex gap-2 justify-end">
                  <button
                    onClick={() => { setHandoffOpen(false); setHandoffError(null); }}
                    className="text-sm px-3 py-1 rounded border border-border hover:bg-bg-hover"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleHandoff}
                    disabled={!handoffTarget || handoffTask.isPending}
                    className="text-sm px-3 py-1 rounded bg-accent text-white disabled:opacity-50"
                  >
                    {handoffTask.isPending ? "Handing off…" : "Hand off & run"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Post comment form */}
          <form onSubmit={handlePostComment} className="mt-4">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Write a comment..."
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 min-h-[80px] resize-y"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={postComment.isPending || !commentBody.trim()}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {postComment.isPending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </div>

        {/* Right: Details */}
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
            Details
          </h2>
          <div className="rounded-lg border border-border p-4">
            <PropertyRow label="Status">
              <select
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </PropertyRow>
            <PropertyRow label="Priority">
              {task.priority ? (
                <Badge color={PRIORITY_COLORS[task.priority] ?? "gray"}>
                  {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                </Badge>
              ) : (
                "\u2014"
              )}
            </PropertyRow>
            <PropertyRow label="Assignee">
              <AssigneePicker
                label=""
                value={currentAssignee}
                onChange={handleAssigneeChange}
              />
              {currentAssignee.kind === "agent" && !isTerminal && (
                <p className="mt-1 text-[11px] text-text-tertiary">Agent wakes on assign.</p>
              )}
            </PropertyRow>
            <PropertyRow label="Created">
              {new Date(task.createdAt).toLocaleDateString()}
            </PropertyRow>
            <PropertyRow label="Updated">
              {new Date(task.updatedAt).toLocaleDateString()}
            </PropertyRow>
          </div>

          {/* Work Products */}
          {workProducts.length > 0 && (
            <>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3 mt-6">
                Work Products
              </h2>
              <div className="rounded-lg border border-border">
                {workProducts.map((wp: any, i: number) => (
                  <div
                    key={wp.id}
                    className={`px-4 py-2.5 text-sm text-text-primary ${
                      i < workProducts.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    {wp.title ?? wp.id}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Agent Runs */}
          {runs.length > 0 && (
            <>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3 mt-6">
                Agent Runs
              </h2>
              <div className="rounded-lg border border-border">
                {runs.map((run: any, i: number) => (
                  <div
                    key={run.id}
                    className={`px-4 py-3 ${i < runs.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-text-primary">
                        {run.agentName ?? "Agent"}
                      </span>
                      <Badge color={
                        run.status === "done" ? "green" :
                        run.status === "failed" ? "red" :
                        run.status === "running" ? "blue" : "gray"
                      }>
                        {run.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
                      {run.model && <span>{run.model}</span>}
                      {(run.inputTokens > 0 || run.outputTokens > 0) && (
                        <span>{formatTokens(run.inputTokens)} in / {formatTokens(run.outputTokens)} out</span>
                      )}
                      {run.costUsd > 0 && <span>{formatCost(run.costUsd)}</span>}
                      <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
