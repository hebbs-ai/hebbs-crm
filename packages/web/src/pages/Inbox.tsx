import { useState } from "react";
import { useAllInboxItems, useArchiveInboxItem, useCreateTaskFromInbox, useArchiveInGmail, useReplyToEmail, useSyncInbox } from "../hooks/useInbox";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { EmailViewerModal } from "../components/EmailViewerModal";

const PAGE_SIZE = 25;

interface AgentAnalysis {
  score: number;
  classification: string;
  summary: string;
  contactMatch?: { id?: string; email: string; name: string };
  dealContext?: string;
  suggestedAction?: string;
  draftResponse?: string;
  processedAt: string;
}

interface InboxItem {
  id: string;
  source: string;
  subject: string;
  body: string | null;
  from: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function getAnalysis(item: InboxItem): AgentAnalysis | null {
  const meta = item.metadata as Record<string, unknown> | null;
  return (meta?.agentAnalysis as AgentAnalysis) ?? null;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const sourceColors: Record<string, "red" | "blue" | "purple" | "green" | "gray"> = {
  gmail: "red",
  calendar: "purple",
  slack: "blue",
  form: "green",
};

const classColors: Record<string, "green" | "blue" | "gray" | "yellow" | "orange" | "red"> = {
  lead: "green",
  reply: "blue",
  internal: "gray",
  newsletter: "yellow",
  spam: "red",
};

function scoreColor(score: number): "green" | "blue" | "yellow" | "gray" {
  if (score >= 90) return "green";
  if (score >= 70) return "blue";
  if (score >= 50) return "yellow";
  return "gray";
}

export function InboxPage() {
  const { active, handled, isLoading } = useAllInboxItems();
  const dismiss = useArchiveInboxItem();
  const archiveGmail = useArchiveInGmail();
  const createTask = useCreateTaskFromInbox();
  const sendReply = useReplyToEmail();
  const sync = useSyncInbox();
  const [showAutoHandled, setShowAutoHandled] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [autoHandledLimit, setAutoHandledLimit] = useState(PAGE_SIZE);
  const [dismissedLimit, setDismissedLimit] = useState(PAGE_SIZE);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [selectedMode, setSelectedMode] = useState<"attention" | "handled">("attention");

  // Split active items by score
  const needsAttention = active
    .filter((i) => {
      const a = getAnalysis(i as InboxItem);
      return !a || a.score >= 50;
    })
    .sort((a, b) => {
      const sa = getAnalysis(a as InboxItem)?.score ?? 999;
      const sb = getAnalysis(b as InboxItem)?.score ?? 999;
      return sb - sa;
    });

  const autoHandled = active.filter((i) => {
    const a = getAnalysis(i as InboxItem);
    return a && a.score < 50;
  });

  const dismissed = handled;

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Inbox"
        subtitle={`${needsAttention.length} need${needsAttention.length !== 1 ? "" : "s"} attention \u00B7 ${autoHandled.length} auto-handled \u00B7 ${dismissed.length} dismissed`}
        actions={
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {sync.isPending ? "Syncing..." : "Fetch emails"}
          </button>
        }
      />

      {needsAttention.length === 0 && autoHandled.length === 0 && dismissed.length === 0 ? (
        <EmptyState
          title="Inbox is empty"
          description="Connect Gmail in Settings to start receiving emails"
        />
      ) : (
        <>
          {selectedItem && (
            <EmailViewerModal
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              mode={selectedMode}
              onArchiveGmail={() => { archiveGmail.mutate(selectedItem.id); setSelectedItem(null); }}
            />
          )}

          {/* Needs Your Attention */}
          {needsAttention.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
                {"\u26A1"} Needs Your Attention
              </h2>
              <div className="space-y-3">
                {needsAttention.map((item) => (
                  <AttentionCard
                    key={item.id}
                    item={item as InboxItem}
                    onDismiss={() => dismiss.mutate(item.id)}
                    onArchiveGmail={() => archiveGmail.mutate(item.id)}
                    onCreateTask={() => createTask.mutate(item.id)}
                    onSendDraft={(body) => sendReply.mutate({ id: item.id, body })}
                    isSending={sendReply.isPending}
                    onClick={() => { setSelectedItem(item as InboxItem); setSelectedMode("attention"); }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Auto-Handled */}
          {autoHandled.length > 0 && (
            <section className="mb-6">
              <button
                onClick={() => setShowAutoHandled(!showAutoHandled)}
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3 hover:text-text-secondary transition-colors"
              >
                <span>{showAutoHandled ? "\u25BC" : "\u25B6"}</span>
                Auto-Handled ({autoHandled.length})
              </button>
              {showAutoHandled && (
                <div className="space-y-1">
                  {autoHandled.slice(0, autoHandledLimit).map((item) => (
                    <CompactRow
                      key={item.id}
                      item={item as InboxItem}
                      onClick={() => { setSelectedItem(item as InboxItem); setSelectedMode("handled"); }}
                      onArchiveGmail={() => archiveGmail.mutate(item.id)}
                    />
                  ))}
                  {autoHandled.length > autoHandledLimit && (
                    <ShowMoreButton
                      remaining={autoHandled.length - autoHandledLimit}
                      onClick={() => setAutoHandledLimit((l) => l + PAGE_SIZE)}
                    />
                  )}
                </div>
              )}
            </section>
          )}

          {/* Dismissed */}
          {dismissed.length > 0 && (
            <section>
              <button
                onClick={() => setShowDismissed(!showDismissed)}
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3 hover:text-text-secondary transition-colors"
              >
                <span>{showDismissed ? "\u25BC" : "\u25B6"}</span>
                Dismissed ({dismissed.length})
              </button>
              {showDismissed && (
                <div className="space-y-1">
                  {dismissed.slice(0, dismissedLimit).map((item) => (
                    <CompactRow
                      key={item.id}
                      item={item as InboxItem}
                      onClick={() => { setSelectedItem(item as InboxItem); setSelectedMode("handled"); }}
                      onArchiveGmail={() => archiveGmail.mutate(item.id)}
                    />
                  ))}
                  {dismissed.length > dismissedLimit && (
                    <ShowMoreButton
                      remaining={dismissed.length - dismissedLimit}
                      onClick={() => setDismissedLimit((l) => l + PAGE_SIZE)}
                    />
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ShowMoreButton({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-center py-2 text-xs text-accent hover:underline transition-colors"
    >
      Show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)
    </button>
  );
}

function AttentionCard({
  item,
  onDismiss,
  onArchiveGmail,
  onCreateTask,
  onSendDraft,
  isSending,
  onClick,
}: {
  item: InboxItem;
  onDismiss: () => void;
  onArchiveGmail: () => void;
  onCreateTask: () => void;
  onSendDraft: (body: string) => void;
  isSending: boolean;
  onClick: () => void;
}) {
  const analysis = getAnalysis(item);
  const [showDraft, setShowDraft] = useState(false);

  return (
    <div className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow cursor-pointer" onClick={onClick}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <Badge color={sourceColors[item.source] ?? "gray"}>{item.source}</Badge>
        {analysis && (
          <>
            <Badge color={classColors[analysis.classification] ?? "gray"}>{analysis.classification}</Badge>
            <Badge color={scoreColor(analysis.score)}>{analysis.score}</Badge>
          </>
        )}
        {!analysis && (
          <span className="text-xs text-text-tertiary animate-pulse">Pending analysis...</span>
        )}
        <span className="ml-auto text-xs text-text-tertiary">{relativeTime(item.createdAt)}</span>
      </div>

      {/* Subject + From */}
      <div className="font-medium text-sm text-text-primary">{item.subject || "No subject"}</div>
      <div className="text-xs text-text-secondary mt-0.5">{item.from || "Unknown sender"}</div>

      {/* Agent analysis */}
      {analysis && (
        <div className="mt-3 bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3">
          <div className="text-[11px] font-semibold text-text-blue uppercase tracking-wide mb-1">
            {"\u25C7"} Agent Analysis
          </div>
          <p className="text-sm text-text-primary">{analysis.summary}</p>
          {analysis.contactMatch && (
            <p className="text-xs text-text-secondary mt-1">
              Contact: <span className="text-accent">{analysis.contactMatch.name}</span> ({analysis.contactMatch.email})
            </p>
          )}
          {analysis.dealContext && (
            <p className="text-xs text-text-secondary mt-0.5">
              Deal: <span className="text-accent">{analysis.dealContext}</span>
            </p>
          )}
          {analysis.suggestedAction && (
            <p className="text-xs text-text-blue mt-1">{"\u2192"} {analysis.suggestedAction}</p>
          )}
        </div>
      )}

      {/* Draft response */}
      {analysis?.draftResponse && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowDraft(!showDraft)}
            className="text-xs text-accent hover:underline"
          >
            {showDraft ? "Hide draft" : "Show draft response"}
          </button>
          {showDraft && (
            <div className="mt-2 bg-bg-secondary rounded-md p-3 text-sm text-text-primary whitespace-pre-wrap">
              {analysis.draftResponse}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
        {analysis?.draftResponse && (
          <button
            onClick={() => onSendDraft(analysis.draftResponse!)}
            disabled={isSending}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {isSending ? "Sending..." : "Send Draft"}
          </button>
        )}
        <button
          onClick={onCreateTask}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text-primary hover:bg-bg-hover transition-colors"
        >
          Create Task
        </button>
        <button
          onClick={onDismiss}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors"
          title="Remove from CRM inbox (email stays in Gmail)"
        >
          Dismiss
        </button>
        {item.source === "gmail" && (
          <button
            onClick={onArchiveGmail}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors"
            title="Archive in Gmail and remove from CRM inbox"
          >
            Archive in Gmail
          </button>
        )}
      </div>
    </div>
  );
}

function CompactRow({
  item,
  onClick,
  onArchiveGmail,
}: {
  item: InboxItem;
  onClick: () => void;
  onArchiveGmail: () => void;
}) {
  const analysis = getAnalysis(item);
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border cursor-pointer hover:bg-bg-hover transition-colors group" onClick={onClick}>
      <span className="text-text-green">{"\u2713"}</span>
      <Badge color={classColors[analysis?.classification ?? ""] ?? "gray"}>
        {analysis?.classification ?? "unknown"}
      </Badge>
      <span className="text-text-secondary truncate flex-1">
        {analysis?.summary || item.subject || "No subject"}
      </span>
      <span className="text-xs text-text-tertiary shrink-0 mr-1">{relativeTime(item.createdAt)}</span>
      {item.source === "gmail" && (
        <button
          onClick={(e) => { e.stopPropagation(); onArchiveGmail(); }}
          className="opacity-0 group-hover:opacity-100 rounded px-2 py-0.5 text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-active transition-all shrink-0"
          title="Archive in Gmail"
        >
          Archive in Gmail
        </button>
      )}
    </div>
  );
}
