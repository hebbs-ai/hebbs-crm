import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useDeals, useForecast } from "../hooks/useDeals";
import { usePipelines } from "../hooks/usePipelines";
import { useActivities } from "../hooks/useActivities";
import { useTasks } from "../hooks/useTasks";
import { useInbox } from "../hooks/useInbox";
import type { Deal, Activity, ForecastEntry } from "@boringos-crm/shared";

// ── Types ──

interface AgentIntelligence {
  riskLevel: "low" | "medium" | "high" | "critical";
  signals: string[];
  narrative: string;
  suggestedNextStep: string;
  smartProbability: number;
  analyzedAt: string;
}

interface FrameworkTask {
  id: string;
  title: string;
  description?: string;
  priority?: string;
  status: string;
  assigneeUserId?: string;
  assigneeAgentId?: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  originKind?: string;
}

interface InboxItem {
  id: string;
  source: string;
  sourceId: string;
  subject: string;
  body: string;
  from: string;
  status: string;
  assigneeUserId: string | null;
  metadata: Record<string, unknown>;
  linkedTaskId: string | null;
  createdAt: string;
}

interface AgentAnalysis {
  score: number;
  summary?: string;
}

// ── Attention item union ──

type AttentionItem =
  | { kind: "at-risk-deal"; deal: Deal; intelligence: AgentIntelligence; daysSilent: number }
  | { kind: "agent-task"; task: FrameworkTask }
  | { kind: "high-inbox"; item: InboxItem; analysis: AgentAnalysis };

// ── Overnight item ──

interface OvernightItem {
  id: string;
  icon: string;
  description: string;
  time: string;
  link?: string;
}

// ── Helpers ──

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function centsToDisplay(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return currencyFmt.format(dollars);
}

function centsToFull(cents: number): string {
  return currencyFmt.format(cents / 100);
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "yesterday";
  if (diffD < 30) return `${diffD}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDateHeader(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function getAgentIntelligence(deal: Deal): AgentIntelligence | null {
  const ai = deal.customFields?.agentIntelligence;
  if (!ai || typeof ai !== "object") return null;
  return ai as unknown as AgentIntelligence;
}

function getAgentAnalysis(item: InboxItem): AgentAnalysis | null {
  const meta = item.metadata;
  if (!meta) return null;
  const analysis = meta.agentAnalysis;
  if (!analysis || typeof analysis !== "object") return null;
  return analysis as unknown as AgentAnalysis;
}

function isLast24Hours(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < 86_400_000;
}

const ACTIVITY_ICONS: Record<string, string> = {
  call: "\u{1F4DE}",
  email: "\u2709\uFE0F",
  meeting: "\u{1F4C5}",
  note: "\u{1F4DD}",
  task: "\u2705",
};

// ── Sub-components ──

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="border border-border rounded-lg p-4 flex-1 min-w-[140px]">
      <div className="text-2xl font-bold tracking-tight text-text-primary">{value}</div>
      <div className="text-xs text-text-tertiary mt-0.5">{label}</div>
    </div>
  );
}

function AgentInsight({ text }: { text: string }) {
  return (
    <div className="bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3 mt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs">🤖</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          Agent insight
        </span>
      </div>
      <p className="text-sm text-text-secondary">{text}</p>
    </div>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  if (item.kind === "at-risk-deal") {
    const { deal, intelligence, daysSilent } = item;
    return (
      <div className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">⚠️</span>
          <span className="font-semibold text-sm text-text-primary">{deal.title}</span>
          <span className="ml-auto text-xs text-text-tertiary">
            {daysSilent}d silent
          </span>
        </div>
        <p className="text-sm text-text-secondary pl-[26px] mb-2">
          {centsToFull(deal.value)} &middot; {intelligence.riskLevel} risk &middot; {daysSilent} days
          without activity
        </p>
        <div className="pl-[26px]">
          <AgentInsight text={intelligence.suggestedNextStep} />
        </div>
        <div className="flex gap-1.5 pl-[26px] mt-3">
          <Link
            to={`/deals/${deal.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            View deal
          </Link>
          <Link
            to={`/deals/${deal.id}?action=follow-up`}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium border border-border text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            Send follow-up
          </Link>
        </div>
      </div>
    );
  }

  if (item.kind === "agent-task") {
    const { task } = item;
    return (
      <div className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">📝</span>
          <span className="font-semibold text-sm text-text-primary">{task.title}</span>
          <span className="ml-auto text-xs text-text-tertiary">
            {relativeTime(task.createdAt)}
          </span>
        </div>
        {task.description && (
          <p className="text-sm text-text-secondary pl-[26px] mb-2 line-clamp-2">
            {task.description}
          </p>
        )}
        <div className="pl-[26px]">
          <AgentInsight text="Agent drafted this for your review." />
        </div>
        <div className="flex gap-1.5 pl-[26px] mt-3">
          <Link
            to={`/tasks/${task.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            View draft
          </Link>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium border border-border text-text-secondary hover:bg-bg-secondary transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // high-inbox
  const { item: inboxItem, analysis } = item;
  return (
    <div className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">✉️</span>
        <span className="font-semibold text-sm text-text-primary">{inboxItem.subject}</span>
        <span className="ml-auto text-xs text-text-tertiary">
          {relativeTime(inboxItem.createdAt)}
        </span>
      </div>
      <p className="text-sm text-text-secondary pl-[26px] mb-2">
        From: {inboxItem.from}
      </p>
      {analysis.summary && (
        <div className="pl-[26px]">
          <AgentInsight text={analysis.summary} />
        </div>
      )}
      <div className="flex gap-1.5 pl-[26px] mt-3">
        <Link
          to="/inbox"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          View inbox
        </Link>
      </div>
    </div>
  );
}

function OvernightRow({ item }: { item: OvernightItem }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
      <span className="text-base shrink-0">{item.icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-text-primary truncate block">{item.description}</span>
      </div>
      <span className="text-xs text-text-tertiary shrink-0">{relativeTime(item.time)}</span>
      {item.link && (
        <Link to={item.link} className="text-xs text-accent hover:underline shrink-0">
          View &rarr;
        </Link>
      )}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-bg-secondary rounded w-64" />
      <div className="h-4 bg-bg-secondary rounded w-48" />
      <div className="flex gap-4 mt-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-bg-secondary rounded-lg flex-1" />
        ))}
      </div>
      <div className="h-32 bg-bg-secondary rounded-lg mt-6" />
      <div className="h-32 bg-bg-secondary rounded-lg" />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
      {children}
    </div>
  );
}

// ── Page ──

export function BriefPage() {
  const { user } = useAuth();

  // Data sources
  const { data: pipelinesRes, isLoading: pipelinesLoading } = usePipelines();
  const pipelines = pipelinesRes?.data ?? [];
  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  const { data: forecastRes, isLoading: forecastLoading } = useForecast(defaultPipeline?.id ?? "");
  const forecast = forecastRes?.data;

  const { data: dealsRes, isLoading: dealsLoading } = useDeals();
  const deals: Deal[] = dealsRes?.data ?? [];

  const { data: activitiesRes, isLoading: activitiesLoading } = useActivities();
  const activities: Activity[] = activitiesRes?.data ?? [];

  const { data: tasksRes, isLoading: tasksLoading } = useTasks();
  const allTasks: FrameworkTask[] = (tasksRes?.data ?? []) as FrameworkTask[];

  const { data: inboxRes, isLoading: inboxLoading } = useInbox("unread");
  const inboxItems: InboxItem[] = (inboxRes?.items ?? []) as InboxItem[];

  const isLoading =
    pipelinesLoading || forecastLoading || dealsLoading || activitiesLoading || tasksLoading || inboxLoading;

  // ── Needs Your Attention ──
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    // At-risk deals
    for (const deal of deals) {
      const intelligence = getAgentIntelligence(deal);
      if (
        intelligence &&
        (intelligence.riskLevel === "high" || intelligence.riskLevel === "critical")
      ) {
        const daysSilent = daysBetween(new Date(deal.updatedAt), new Date());
        items.push({ kind: "at-risk-deal", deal, intelligence, daysSilent });
      }
    }

    // Agent tasks needing review (todo, originKind starts with "agent")
    for (const task of allTasks) {
      if (task.status === "todo" && task.originKind?.startsWith("agent")) {
        items.push({ kind: "agent-task", task });
      }
    }

    // High-priority inbox items
    for (const item of inboxItems) {
      const analysis = getAgentAnalysis(item);
      if (analysis && analysis.score >= 70) {
        items.push({ kind: "high-inbox", item, analysis });
      }
    }

    return items;
  }, [deals, allTasks, inboxItems]);

  // ── Pipeline Snapshot ──
  const { closingThisWeek, atRiskCount, totalPipelineValue } = useMemo(() => {
    const now = new Date();
    let closing = 0;
    let atRisk = 0;
    let total = 0;

    for (const deal of deals) {
      total += deal.value;

      if (deal.expectedCloseDate) {
        const daysUntilClose = daysBetween(now, new Date(deal.expectedCloseDate));
        if (daysUntilClose >= 0 && daysUntilClose <= 7) closing++;
      }

      const intelligence = getAgentIntelligence(deal);
      if (
        intelligence &&
        (intelligence.riskLevel === "high" || intelligence.riskLevel === "critical")
      ) {
        atRisk++;
      }
    }

    return { closingThisWeek: closing, atRiskCount: atRisk, totalPipelineValue: total };
  }, [deals]);

  // ── Overnight Activity ──
  const overnightItems = useMemo<OvernightItem[]>(() => {
    const items: OvernightItem[] = [];

    // Recent activities (last 24h)
    for (const a of activities) {
      if (isLast24Hours(a.occurredAt)) {
        items.push({
          id: `activity-${a.id}`,
          icon: ACTIVITY_ICONS[a.type] ?? "\u25CB",
          description: a.subject,
          time: a.occurredAt,
          link: a.dealId ? `/deals/${a.dealId}` : undefined,
        });
      }
    }

    // Recently completed agent tasks
    for (const task of allTasks) {
      if (
        task.status === "done" &&
        task.originKind?.startsWith("agent") &&
        isLast24Hours(task.updatedAt)
      ) {
        items.push({
          id: `task-${task.id}`,
          icon: "🤖",
          description: `Agent completed: ${task.title}`,
          time: task.updatedAt,
          link: `/tasks/${task.id}`,
        });
      }
    }

    // Sort by time DESC, take 10
    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return items.slice(0, 10);
  }, [activities, allTasks]);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  const hasAgentData = attentionItems.length > 0 || overnightItems.some((i) => i.icon === "🤖");

  if (isLoading) {
    return (
      <div className="px-20 py-8 max-w-[1100px]">
        <SkeletonBlock />
      </div>
    );
  }

  return (
    <div className="px-20 py-8 max-w-[1100px]">
      {/* ── Header ── */}
      <h1 className="text-[30px] font-bold tracking-tight leading-tight mb-1">
        {greeting()}, {firstName}.
      </h1>
      <p className="text-sm text-text-secondary mb-1">{formatDateHeader()}</p>
      <p className="text-sm text-text-tertiary mb-6">
        {centsToDisplay(totalPipelineValue)} pipeline
        {closingThisWeek > 0 && <> &middot; {closingThisWeek} deal{closingThisWeek !== 1 && "s"} closing this week</>}
      </p>

      {/* ── Pipeline Snapshot ── */}
      <SectionLabel>Pipeline snapshot</SectionLabel>
      <div className="flex gap-4 mb-8">
        <MetricCard value={centsToDisplay(totalPipelineValue)} label="Pipeline value" />
        {forecast && (
          <MetricCard value={centsToDisplay(forecast.totalWeightedValue)} label="Weighted value" />
        )}
        <MetricCard value={String(deals.length)} label="Total deals" />
        <MetricCard value={String(closingThisWeek)} label="Closing this week" />
        <MetricCard value={String(atRiskCount)} label="At risk" />
      </div>

      {/* ── Needs Your Attention ── */}
      <SectionLabel>Needs your attention</SectionLabel>
      {attentionItems.length > 0 ? (
        <div className="space-y-2.5 mb-8">
          {attentionItems.map((item) => {
            const key =
              item.kind === "at-risk-deal"
                ? `deal-${item.deal.id}`
                : item.kind === "agent-task"
                  ? `task-${item.task.id}`
                  : `inbox-${item.item.id}`;
            return <AttentionCard key={key} item={item} />;
          })}
        </div>
      ) : (
        <div className="bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3 mb-8">
          <p className="text-sm text-text-secondary">
            {hasAgentData
              ? "Nothing urgent today. All deals are on track."
              : "Agents will surface insights here once they've analyzed your pipeline."}
          </p>
        </div>
      )}

      {/* ── Overnight Activity ── */}
      <SectionLabel>Overnight activity</SectionLabel>
      {overnightItems.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden mb-8">
          {overnightItems.map((item) => (
            <OvernightRow key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3 mb-8">
          <p className="text-sm text-text-secondary">
            No recent activity in the last 24 hours.
          </p>
        </div>
      )}
    </div>
  );
}
