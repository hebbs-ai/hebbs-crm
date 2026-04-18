import { useState } from "react";
import type { ActionItem } from "../hooks/useActions";
import { useDismissAction, useExecuteAction, useCompleteAction } from "../hooks/useActions";

interface ActionCardProps {
  action: ActionItem;
}

/**
 * Renders one action queue item. Variant chosen by `originKind`:
 * - agent_action  → Approve / Edit & run / Dismiss
 * - human_todo    → Tick done / Dismiss
 * - agent_blocked → Open thread (Phase 2 will inline the comment editor)
 *
 * Phase 1: minimal — Approve / Dismiss / Complete / "Why?" expand. Edit & run,
 * inline comments, parent breadcrumb come in Phase 2.
 */
export function ActionCard({ action }: ActionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const dismiss = useDismissAction();
  const execute = useExecuteAction();
  const complete = useCompleteAction();

  const params = action.proposedParams ?? {};
  const kind = (params.kind as string | undefined) ?? "(no kind)";

  async function onApprove() {
    setBusy("approve");
    try { await execute.mutateAsync({ id: action.id }); } finally { setBusy(null); }
  }
  async function onDismiss() {
    setBusy("dismiss");
    try { await dismiss.mutateAsync(action.id); } finally { setBusy(null); }
  }
  async function onComplete() {
    setBusy("complete");
    try { await complete.mutateAsync(action.id); } finally { setBusy(null); }
  }

  const variantLabel = action.originKind === "agent_action" ? "Action"
    : action.originKind === "human_todo" ? "To-do"
    : action.originKind === "agent_blocked" ? "Awaiting answer"
    : action.originKind;

  return (
    <div className="border border-border rounded-md p-4 bg-bg hover:bg-bg-hover transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary px-1.5 py-0.5 rounded border border-border">
              {variantLabel}
            </span>
            {action.originKind === "agent_action" && (
              <span className="text-[10px] text-text-tertiary font-mono">{kind}</span>
            )}
          </div>
          <h3 className="font-medium text-sm text-text-primary">{action.title}</h3>
          {action.description && (
            <p className="text-sm text-text-secondary mt-0.5">{action.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {action.originKind === "agent_action" && (
            <>
              <button
                onClick={onApprove}
                disabled={busy !== null}
                className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {busy === "approve" ? "..." : "Approve"}
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
            <a
              href={`/tasks/${action.id}`}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:opacity-90"
            >
              Reply →
            </a>
          )}
        </div>
      </div>

      {action.proposedParams && Object.keys(action.proposedParams).length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-text-tertiary hover:text-text-secondary"
        >
          {expanded ? "Hide" : "Show"} proposed payload
        </button>
      )}
      {expanded && action.proposedParams && (
        <pre className="mt-2 text-xs bg-bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(action.proposedParams, null, 2)}
        </pre>
      )}

      {(execute.error || dismiss.error || complete.error) && (
        <div className="mt-2 text-xs text-red-500">
          {(execute.error as Error | undefined)?.message ?? (dismiss.error as Error | undefined)?.message ?? (complete.error as Error | undefined)?.message}
        </div>
      )}
    </div>
  );
}
