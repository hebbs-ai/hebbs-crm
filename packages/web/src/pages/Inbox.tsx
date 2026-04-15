import { useState } from "react";
import { useAllInboxItems, useArchiveInboxItem, useCreateTaskFromInbox } from "../hooks/useInbox";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

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
  const archive = useArchiveInboxItem();
  const createTask = useCreateTaskFromInbox();
  const [showAutoHandled, setShowAutoHandled] = useState(false);

  // Split active items by score
  const needsAttention = active
    .filter((i) => {
      const a = getAnalysis(i as InboxItem);
      return !a || a.score >= 50; // unprocessed or high score
    })
    .sort((a, b) => {
      const sa = getAnalysis(a as InboxItem)?.score ?? 999;
      const sb = getAnalysis(b as InboxItem)?.score ?? 999;
      return sb - sa; // highest score first
    });

  const lowPriority = active.filter((i) => {
    const a = getAnalysis(i as InboxItem);
    return a && a.score < 50;
  });

  const autoHandled = [...lowPriority, ...handled];

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Inbox"
        subtitle={`${needsAttention.length} need${needsAttention.length !== 1 ? "" : "s"} your attention \u00B7 ${autoHandled.length} auto-handled`}
      />

      {needsAttention.length === 0 && autoHandled.length === 0 ? (
        <EmptyState
          title="Inbox is empty"
          description="Connect Gmail in Settings to start receiving emails"
        />
      ) : (
        <>
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
                    onArchive={() => archive.mutate(item.id)}
                    onCreateTask={() => createTask.mutate(item.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Auto-Handled */}
          {autoHandled.length > 0 && (
            <section>
              <button
                onClick={() => setShowAutoHandled(!showAutoHandled)}
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3 hover:text-text-secondary transition-colors"
              >
                <span>{showAutoHandled ? "\u25BC" : "\u25B6"}</span>
                Auto-Handled ({autoHandled.length})
              </button>
              {showAutoHandled && (
                <div className="space-y-1">
                  {autoHandled.map((item) => (
                    <AutoHandledRow key={item.id} item={item as InboxItem} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AttentionCard({
  item,
  onArchive,
  onCreateTask,
}: {
  item: InboxItem;
  onArchive: () => void;
  onCreateTask: () => void;
}) {
  const analysis = getAnalysis(item);
  const [showDraft, setShowDraft] = useState(false);

  return (
    <div className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
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
        <div className="mt-2">
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
      <div className="flex gap-2 mt-3">
        {analysis?.draftResponse && (
          <button className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors">
            Send Draft
          </button>
        )}
        <button
          onClick={onCreateTask}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text-primary hover:bg-bg-hover transition-colors"
        >
          Create Task
        </button>
        <button
          onClick={onArchive}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors"
        >
          Archive
        </button>
      </div>
    </div>
  );
}

function AutoHandledRow({ item }: { item: InboxItem }) {
  const analysis = getAnalysis(item);
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border">
      <span className="text-text-green">{"\u2713"}</span>
      <Badge color={classColors[analysis?.classification ?? ""] ?? "gray"}>
        {analysis?.classification ?? "unknown"}
      </Badge>
      <span className="text-text-secondary truncate flex-1">
        {analysis?.summary || item.subject || "No subject"}
      </span>
      <span className="text-xs text-text-tertiary shrink-0">{relativeTime(item.createdAt)}</span>
    </div>
  );
}
