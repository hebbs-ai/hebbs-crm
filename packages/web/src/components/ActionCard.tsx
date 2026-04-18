import { useState } from "react";
import type { ActionItem } from "../hooks/useActions";
import {
  useDismissAction, useExecuteAction, useCompleteAction,
  useActionComments, usePostActionComment, useParentTask,
} from "../hooks/useActions";

interface ActionCardProps {
  action: ActionItem;
}

/**
 * Renders one action queue item. Variant chosen by `originKind`:
 * - agent_action  → Approve / Edit & run / Dismiss (with per-kind editor)
 * - human_todo    → Tick done / Dismiss
 * - agent_blocked → Inline comment thread + reply box (replies wake the agent)
 *
 * Common to all: inline collapsible comments, parent-task breadcrumb, and a
 * "show payload" toggle for debugging the proposedParams.
 */
export function ActionCard({ action }: ActionCardProps) {
  const [showComments, setShowComments] = useState(action.originKind === "agent_blocked");
  const [showPayload, setShowPayload] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editParams, setEditParams] = useState<Record<string, unknown>>(action.proposedParams ?? {});
  const [busy, setBusy] = useState<string | null>(null);

  const dismiss = useDismissAction();
  const execute = useExecuteAction();
  const complete = useCompleteAction();
  const comments = useActionComments(action.id, showComments);
  const postComment = usePostActionComment(action.id);
  const parent = useParentTask(action.parentId);

  const params = action.proposedParams ?? {};
  const kind = (params.kind as string | undefined) ?? "(no kind)";

  async function onApprove() {
    setBusy("approve");
    try { await execute.mutateAsync({ id: action.id }); } finally { setBusy(null); }
  }
  async function onEditRun() {
    setBusy("editrun");
    try {
      await execute.mutateAsync({ id: action.id, params: editParams });
      setEditing(false);
    } finally { setBusy(null); }
  }
  async function onDismiss() {
    setBusy("dismiss");
    try { await dismiss.mutateAsync(action.id); } finally { setBusy(null); }
  }
  async function onComplete() {
    setBusy("complete");
    try { await complete.mutateAsync(action.id); } finally { setBusy(null); }
  }

  const variantLabel =
    action.originKind === "agent_action" ? "Action"
    : action.originKind === "human_todo" ? "To-do"
    : action.originKind === "agent_blocked" ? "Awaiting answer"
    : action.originKind;

  return (
    <div className="border border-border rounded-md p-4 bg-bg hover:bg-bg-hover transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary px-1.5 py-0.5 rounded border border-border">
              {variantLabel}
            </span>
            {action.originKind === "agent_action" && (
              <span className="text-[10px] text-text-tertiary font-mono">{kind}</span>
            )}
            {parent.data && (
              <a
                href={`/tasks/${parent.data.id}`}
                className="text-[10px] text-text-tertiary hover:text-text-secondary px-1.5 py-0.5 rounded bg-bg-secondary"
                title={`Parent task: ${parent.data.title}`}
              >
                ↳ from: {parent.data.title.length > 40 ? parent.data.title.slice(0, 40) + "…" : parent.data.title}
              </a>
            )}
          </div>
          <h3 className="font-medium text-sm text-text-primary">{action.title}</h3>
          {action.description && (
            <p className="text-sm text-text-secondary mt-0.5">{action.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {action.originKind === "agent_action" && !editing && (
            <>
              <button
                onClick={onApprove}
                disabled={busy !== null}
                className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {busy === "approve" ? "..." : "Approve"}
              </button>
              <button
                onClick={() => setEditing(true)}
                disabled={busy !== null}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-hover disabled:opacity-50"
              >
                Edit &amp; run
              </button>
              <button
                onClick={onDismiss}
                disabled={busy !== null}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-hover disabled:opacity-50"
              >
                {busy === "dismiss" ? "..." : "Dismiss"}
              </button>
            </>
          )}
          {action.originKind === "human_todo" && (
            <>
              <button
                onClick={onComplete}
                disabled={busy !== null}
                className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {busy === "complete" ? "..." : "Mark done"}
              </button>
              <button
                onClick={onDismiss}
                disabled={busy !== null}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-hover disabled:opacity-50"
              >
                Dismiss
              </button>
            </>
          )}
          {action.originKind === "agent_blocked" && (
            <button
              onClick={onDismiss}
              disabled={busy !== null}
              className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-hover disabled:opacity-50"
            >
              Cancel agent task
            </button>
          )}
        </div>
      </div>

      {/* Edit & run editor — kind-specific */}
      {editing && action.originKind === "agent_action" && (
        <ParamsEditor kind={kind} params={editParams} onChange={setEditParams} />
      )}
      {editing && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onEditRun}
            disabled={busy !== null}
            className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {busy === "editrun" ? "..." : "Run with edits"}
          </button>
          <button
            onClick={() => { setEditing(false); setEditParams(action.proposedParams ?? {}); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-hover"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Footer toggles */}
      <div className="mt-2 flex items-center gap-3 text-xs text-text-tertiary">
        <button onClick={() => setShowComments((v) => !v)} className="hover:text-text-secondary">
          {showComments ? "Hide" : "Show"} comments
          {comments.data && ` (${comments.data.data.length})`}
        </button>
        {action.proposedParams && Object.keys(action.proposedParams).length > 0 && (
          <button onClick={() => setShowPayload((v) => !v)} className="hover:text-text-secondary">
            {showPayload ? "Hide" : "Show"} payload
          </button>
        )}
      </div>

      {showPayload && action.proposedParams && (
        <pre className="mt-2 text-xs bg-bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(action.proposedParams, null, 2)}
        </pre>
      )}

      {showComments && (
        <div className="mt-3 border-t border-border pt-3 space-y-2">
          {comments.isLoading && <div className="text-xs text-text-tertiary">Loading…</div>}
          {comments.data?.data.length === 0 && <div className="text-xs text-text-tertiary italic">No comments yet.</div>}
          {comments.data?.data.map((c) => (
            <div key={c.id} className="text-sm">
              <div className="text-[10px] text-text-tertiary mb-0.5">
                {c.authorAgentId ? "agent" : "you"} · {new Date(c.createdAt).toLocaleString()}
              </div>
              <div className="text-text-primary whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
          <CommentBox
            placeholder={action.originKind === "agent_blocked" ? "Reply to unblock the agent…" : "Add a comment…"}
            onSubmit={(body) => postComment.mutateAsync(body)}
          />
        </div>
      )}

      {(execute.error || dismiss.error || complete.error) && (
        <div className="mt-2 text-xs text-red-500">
          {(execute.error as Error | undefined)?.message ?? (dismiss.error as Error | undefined)?.message ?? (complete.error as Error | undefined)?.message}
        </div>
      )}
    </div>
  );
}

function CommentBox({ placeholder, onSubmit }: { placeholder: string; onSubmit: (body: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setPosting(true);
        try { await onSubmit(text); setText(""); } finally { setPosting(false); }
      }}
      className="flex gap-2 items-start"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="flex-1 text-sm border border-border rounded-md px-2 py-1.5 bg-bg resize-none"
      />
      <button
        type="submit"
        disabled={posting || !text.trim()}
        className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
      >
        {posting ? "..." : "Send"}
      </button>
    </form>
  );
}

/**
 * Per-kind editor for the Edit & run flow. Phase 2 implements log_activity;
 * Phase 3 will add reply, schedule_meeting, update_stage.
 */
function ParamsEditor({ kind, params, onChange }: {
  kind: string; params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: unknown) => onChange({ ...params, [k]: v });

  if (kind === "log_activity") {
    return (
      <div className="mt-3 border border-border rounded-md p-3 bg-bg-secondary space-y-2">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-text-tertiary">Type</label>
          <select
            value={(params.type as string) ?? "note"}
            onChange={(e) => set("type", e.target.value)}
            className="block w-full mt-0.5 text-sm border border-border rounded px-2 py-1 bg-bg"
          >
            <option value="note">note</option>
            <option value="call">call</option>
            <option value="email">email</option>
            <option value="meeting">meeting</option>
            <option value="task">task</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-text-tertiary">Subject</label>
          <input
            type="text"
            value={(params.subject as string) ?? ""}
            onChange={(e) => set("subject", e.target.value)}
            className="block w-full mt-0.5 text-sm border border-border rounded px-2 py-1 bg-bg"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-text-tertiary">Body</label>
          <textarea
            value={(params.body as string) ?? ""}
            onChange={(e) => set("body", e.target.value)}
            rows={4}
            className="block w-full mt-0.5 text-sm border border-border rounded px-2 py-1 bg-bg resize-none"
          />
        </div>
      </div>
    );
  }

  // Generic JSON fallback for kinds without a custom editor (Phase 3 wires more)
  return (
    <div className="mt-3 border border-border rounded-md p-3 bg-bg-secondary">
      <label className="text-[11px] uppercase tracking-wide text-text-tertiary">Params (JSON)</label>
      <textarea
        value={JSON.stringify(params, null, 2)}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)); } catch { /* ignore parse errors mid-edit */ }
        }}
        rows={8}
        className="block w-full mt-0.5 text-xs font-mono border border-border rounded px-2 py-1 bg-bg"
      />
    </div>
  );
}
