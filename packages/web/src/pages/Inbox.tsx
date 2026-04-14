import { useState } from "react";
import { useInbox, useArchiveInboxItem, useCreateTaskFromInbox } from "../hooks/useInbox";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

// --- Types ---

interface AgentAnalysis {
  score: number;
  classification: string;
  summary: string;
  contactMatch?: { email: string; name: string };
  dealContext?: string;
  suggestedAction?: string;
  draftResponse?: string;
  processedAt: string;
}

interface InboxItem {
  id: string;
  source: string;
  sourceId: string | null;
  subject: string;
  body: string | null;
  from: string | null;
  status: string;
  assigneeUserId: string | null;
  metadata: Record<string, unknown> | null;
  linkedTaskId: string | null;
  createdAt: string;
}

// --- Constants ---

type FilterTab = "all" | "leads" | "replies" | "agent" | "archived";

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { label: "All", value: "all" },
  { label: "Leads", value: "leads" },
  { label: "Replies", value: "replies" },
  { label: "Agent Activity", value: "agent" },
  { label: "Archived", value: "archived" },
];

const SOURCE_COLORS: Record<string, "red" | "purple" | "blue" | "green" | "gray"> = {
  gmail: "red",
  calendar: "purple",
  slack: "blue",
  form: "green",
};

const CLASSIFICATION_COLORS: Record<string, "green" | "blue" | "gray" | "yellow" | "red"> = {
  lead: "green",
  reply: "blue",
  internal: "gray",
  newsletter: "yellow",
  spam: "red",
};

// --- Helpers ---

function getAnalysis(item: InboxItem): AgentAnalysis | null {
  if (!item.metadata || !item.metadata.agentAnalysis) return null;
  return item.metadata.agentAnalysis as AgentAnalysis;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function scoreBadgeColor(score: number): "green" | "blue" | "yellow" | "gray" {
  if (score >= 90) return "green";
  if (score >= 70) return "blue";
  if (score >= 50) return "yellow";
  return "gray";
}

function needsAttention(item: InboxItem): boolean {
  const analysis = getAnalysis(item);
  if (!analysis) return true; // unprocessed items need attention
  return analysis.score >= 50;
}

function filterItems(items: InboxItem[], tab: FilterTab): InboxItem[] {
  switch (tab) {
    case "leads":
      return items.filter((i) => {
        const a = getAnalysis(i);
        return a?.classification === "lead";
      });
    case "replies":
      return items.filter((i) => {
        const a = getAnalysis(i);
        return a?.classification === "reply";
      });
    case "agent":
      return items.filter((i) => getAnalysis(i) !== null);
    case "archived":
      return items.filter((i) => i.status === "archived");
    default:
      return items;
  }
}

// --- Components ---

function ScoreBadge({ score }: { score: number }) {
  return <Badge color={scoreBadgeColor(score)}>{score}</Badge>;
}

function PendingIndicator() {
  return (
    <div className="bg-bg-secondary border-l-2 border-border rounded-lg px-4 py-3 flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full bg-text-tertiary animate-pulse" />
      <span className="text-xs text-text-tertiary">Pending analysis...</span>
    </div>
  );
}

function DraftResponseToggle({ draft }: { draft: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-accent hover:text-accent-hover transition-colors"
      >
        {open ? "Hide draft" : "Show draft"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-bg-secondary border border-border px-4 py-3 text-sm text-text-primary whitespace-pre-wrap">
          {draft}
        </div>
      )}
    </div>
  );
}

function AttentionCard({
  item,
  onArchive,
  onCreateTask,
  isArchiving,
  isCreatingTask,
}: {
  item: InboxItem;
  onArchive: (id: string) => void;
  onCreateTask: (id: string) => void;
  isArchiving: boolean;
  isCreatingTask: boolean;
}) {
  const analysis = getAnalysis(item);

  return (
    <div className="rounded-lg border border-border bg-bg-primary p-5 hover:shadow-sm transition-shadow">
      {/* Top row: badges */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Badge color={SOURCE_COLORS[item.source] ?? "gray"}>{item.source}</Badge>
        {analysis && (
          <>
            <Badge color={CLASSIFICATION_COLORS[analysis.classification] ?? "gray"}>
              {analysis.classification}
            </Badge>
            <ScoreBadge score={analysis.score} />
          </>
        )}
        <span className="ml-auto text-xs text-text-tertiary whitespace-nowrap">
          {timeAgo(item.createdAt)}
        </span>
      </div>

      {/* Subject */}
      <h3 className="text-sm font-semibold text-text-primary leading-snug mb-1">
        {item.subject}
        {item.status === "unread" && (
          <span className="ml-2 inline-block w-2 h-2 rounded-full bg-accent align-middle" />
        )}
      </h3>

      {/* From + contact match */}
      {item.from && (
        <p className="text-xs text-text-secondary mb-2">
          {item.from}
          {analysis?.contactMatch && (
            <span className="ml-1 text-accent">
              — {analysis.contactMatch.name}
            </span>
          )}
        </p>
      )}

      {/* Agent analysis card */}
      {analysis ? (
        <div className="bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3 mb-3">
          <p className="text-sm text-text-primary">{analysis.summary}</p>
          {analysis.dealContext && (
            <p className="text-xs text-text-secondary mt-1">
              Deal: {analysis.dealContext}
            </p>
          )}
          {analysis.suggestedAction && (
            <p className="text-xs text-accent mt-1">{analysis.suggestedAction}</p>
          )}
        </div>
      ) : (
        <PendingIndicator />
      )}

      {/* Draft response */}
      {analysis?.draftResponse && (
        <div className="mb-3">
          <DraftResponseToggle draft={analysis.draftResponse} />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {analysis?.draftResponse && (
          <button className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors">
            Send draft
          </button>
        )}
        {analysis?.draftResponse && (
          <button className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover transition-colors">
            Edit
          </button>
        )}
        {item.status !== "archived" && (
          <button
            onClick={() => onArchive(item.id)}
            disabled={isArchiving}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            Archive
          </button>
        )}
        {!item.linkedTaskId ? (
          <button
            onClick={() => onCreateTask(item.id)}
            disabled={isCreatingTask}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-accent hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            Create Task
          </button>
        ) : (
          <Badge color="green">Task linked</Badge>
        )}
        <button className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors">
          Link to Deal
        </button>
      </div>
    </div>
  );
}

function AutoHandledRow({ item }: { item: InboxItem }) {
  const analysis = getAnalysis(item);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0 text-sm">
      <span className="text-text-green shrink-0">&#x2705;</span>
      <span className="text-text-secondary truncate flex-1">
        {analysis?.summary ?? item.subject}
      </span>
      <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">
        {timeAgo(item.createdAt)}
      </span>
    </div>
  );
}

// --- Page ---

export function InboxPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [autoHandledOpen, setAutoHandledOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fetch all items (no server-side filter for the new tab structure)
  const statusParam = activeTab === "archived" ? "archived" : undefined;
  const { data, isLoading } = useInbox(statusParam);
  const archiveItem = useArchiveInboxItem();
  const createTask = useCreateTaskFromInbox();

  const allItems = data?.items ?? [];
  const filtered = filterItems(allItems, activeTab);

  // Split into attention vs auto-handled
  const attentionItems = filtered
    .filter(needsAttention)
    .sort((a, b) => {
      const sa = getAnalysis(a)?.score ?? 100; // unprocessed sorts high
      const sb = getAnalysis(b)?.score ?? 100;
      return sb - sa;
    });

  const autoHandledItems = filtered.filter((i) => !needsAttention(i));

  const handleCreateTask = async (id: string) => {
    try {
      await createTask.mutateAsync(id);
      setSuccessMsg("Task created successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      // error shown via mutation state
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveItem.mutateAsync(id);
    } catch {
      // error shown via mutation state
    }
  };

  const subtitle = isLoading
    ? "Loading..."
    : `${attentionItems.length} need your attention \u00B7 ${autoHandledItems.length} auto-handled today`;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader title="Inbox" subtitle={subtitle} />

      {successMsg && (
        <div className="mb-4 rounded-md bg-surface-green px-4 py-2 text-sm text-text-green">
          {successMsg}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.value
                ? "border-accent text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading...</p>
      ) : allItems.length === 0 ? (
        <EmptyState
          title="Inbox is empty"
          description="New emails, form submissions, and notifications will appear here."
        />
      ) : (
        <div className="space-y-8">
          {/* Needs Your Attention */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">
              Needs Your Attention
              {attentionItems.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-surface-red text-text-red text-[10px] font-bold w-5 h-5">
                  {attentionItems.length}
                </span>
              )}
            </h2>

            {attentionItems.length === 0 ? (
              <p className="text-sm text-text-tertiary py-4">Nothing requires your attention right now.</p>
            ) : (
              <div className="space-y-3">
                {attentionItems.map((item) => (
                  <AttentionCard
                    key={item.id}
                    item={item}
                    onArchive={handleArchive}
                    onCreateTask={handleCreateTask}
                    isArchiving={archiveItem.isPending}
                    isCreatingTask={createTask.isPending}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Auto-Handled */}
          {autoHandledItems.length > 0 && (
            <section>
              <button
                onClick={() => setAutoHandledOpen(!autoHandledOpen)}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3 hover:text-text-secondary transition-colors"
              >
                <span
                  className="inline-block transition-transform"
                  style={{ transform: autoHandledOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  &#x25B6;
                </span>
                Auto-Handled
                <span className="inline-flex items-center justify-center rounded-full bg-bg-hover text-text-secondary text-[10px] font-bold w-5 h-5">
                  {autoHandledItems.length}
                </span>
              </button>

              {autoHandledOpen && (
                <div className="rounded-lg border border-border">
                  {autoHandledItems.map((item) => (
                    <AutoHandledRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
