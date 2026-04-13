import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useDeals, useForecast } from "../hooks/useDeals";
import { usePipelines } from "../hooks/usePipelines";
import { useActivities } from "../hooks/useActivities";
import type { Deal, Activity, ForecastEntry } from "@boringos-crm/shared";

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

const todayStr = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

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

function BriefCard({
  icon,
  title,
  time,
  body,
  dealId,
}: {
  icon: string;
  title: string;
  time?: string;
  body: string;
  dealId?: string | null;
}) {
  return (
    <div className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{icon}</span>
        <span className="font-semibold text-sm text-text-primary">{title}</span>
        {time && <span className="ml-auto text-xs text-text-tertiary">{time}</span>}
      </div>
      <p className="text-sm text-text-secondary pl-[26px] mb-2.5">{body}</p>
      {dealId && (
        <div className="flex gap-1.5 pl-[26px]">
          <Link
            to={`/deals/${dealId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            View deal
          </Link>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
      <span className="text-base shrink-0">{ACTIVITY_ICONS[activity.type] ?? "\u25CB"}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-text-primary truncate block">{activity.subject}</span>
      </div>
      <span className="text-xs text-text-tertiary shrink-0">{relativeTime(activity.occurredAt)}</span>
      {activity.dealId && (
        <Link
          to={`/deals/${activity.dealId}`}
          className="text-xs text-accent hover:underline shrink-0"
        >
          View deal &rarr;
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

// ── Page ──

export function BriefPage() {
  const { user } = useAuth();

  const { data: pipelinesRes, isLoading: pipelinesLoading } = usePipelines();
  const pipelines = pipelinesRes?.data ?? [];
  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  const { data: forecastRes, isLoading: forecastLoading } = useForecast(defaultPipeline?.id ?? "");
  const forecast = forecastRes?.data;

  const { data: dealsRes, isLoading: dealsLoading } = useDeals();
  const deals: Deal[] = dealsRes?.data ?? [];

  const { data: activitiesRes, isLoading: activitiesLoading } = useActivities();
  const activities: Activity[] = activitiesRes?.data ?? [];

  const isLoading = pipelinesLoading || forecastLoading || dealsLoading || activitiesLoading;

  const { closingThisWeek, staleDeals, totalPipelineValue } = useMemo(() => {
    const now = new Date();
    const closing: Deal[] = [];
    const stale: Deal[] = [];
    let total = 0;

    for (const deal of deals) {
      total += deal.value;

      // Deals closing within 7 days
      if (deal.expectedCloseDate) {
        const daysUntilClose = daysBetween(now, new Date(deal.expectedCloseDate));
        if (daysUntilClose >= 0 && daysUntilClose <= 7) {
          closing.push(deal);
        }
      }

      // Stale deals: updatedAt > 14 days ago (proxy for no recent activity)
      const daysSinceUpdate = daysBetween(new Date(deal.updatedAt), now);
      if (daysSinceUpdate >= 14) {
        stale.push(deal);
      }
    }

    return {
      closingThisWeek: closing,
      staleDeals: stale,
      totalPipelineValue: total,
    };
  }, [deals]);

  const recentActivities = useMemo(
    () =>
      [...activities]
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, 10),
    [activities],
  );

  const firstName = user?.name?.split(" ")[0] ?? "there";

  if (isLoading) {
    return (
      <div className="px-20 py-8 max-w-[1100px]">
        <SkeletonBlock />
      </div>
    );
  }

  return (
    <div className="px-20 py-8 max-w-[1100px]">
      {/* Greeting */}
      <h1 className="text-[30px] font-bold tracking-tight leading-tight mb-1">
        {greeting()}, {firstName}.
      </h1>
      <p className="text-sm text-text-secondary mb-6">{todayStr}</p>

      {/* Metrics row */}
      <div className="flex gap-4 mb-8">
        <MetricCard value={centsToDisplay(totalPipelineValue)} label="Pipeline value" />
        <MetricCard value={String(closingThisWeek.length)} label="Closing this week" />
        <MetricCard value={String(deals.length)} label="Active deals" />
        {forecast && (
          <MetricCard
            value={centsToDisplay(forecast.totalWeightedValue)}
            label="Weighted forecast"
          />
        )}
      </div>

      {/* Needs Attention */}
      {(staleDeals.length > 0 || closingThisWeek.length > 0) && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
            Needs your attention
          </div>
          <div className="space-y-2.5 mb-8">
            {staleDeals.map((deal) => {
              const daysSilent = daysBetween(new Date(deal.updatedAt), new Date());
              return (
                <BriefCard
                  key={deal.id}
                  icon={"\u26A0\uFE0F"}
                  title={`${deal.title} \u2014 ${daysSilent} days silent`}
                  body={`This deal hasn\u2019t had any activity in ${daysSilent} days. Value: ${centsToFull(deal.value)}.`}
                  dealId={deal.id}
                />
              );
            })}
            {closingThisWeek.map((deal) => {
              const daysLeft = daysBetween(new Date(), new Date(deal.expectedCloseDate!));
              const timeLabel = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
              return (
                <BriefCard
                  key={deal.id}
                  icon={"\u{1F4C5}"}
                  title={`${deal.title} \u2014 closing ${timeLabel}`}
                  time={new Date(deal.expectedCloseDate!).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  body={`Expected close ${timeLabel}. Value: ${centsToFull(deal.value)}.`}
                  dealId={deal.id}
                />
              );
            })}
          </div>
        </>
      )}

      {staleDeals.length === 0 && closingThisWeek.length === 0 && (
        <div className="bg-bg-secondary border border-border rounded-lg p-4 mb-8 relative">
          <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-accent rounded" />
          <p className="text-sm text-text-secondary pl-3">
            Nothing urgent today. All deals are on track.
          </p>
        </div>
      )}

      {/* Recent Activity */}
      {recentActivities.length > 0 && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
            Recent activity
          </div>
          <div className="border border-border rounded-lg overflow-hidden mb-8">
            {recentActivities.map((a) => (
              <ActivityRow key={a.id} activity={a} />
            ))}
          </div>
        </>
      )}

      {/* Pipeline Snapshot */}
      {forecast && forecast.stages.length > 0 && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
            Pipeline snapshot
          </div>
          <div className="border border-border rounded-lg overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-secondary text-left text-xs text-text-tertiary">
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 font-medium text-right">Deals</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total value</th>
                  <th className="px-4 py-2.5 font-medium text-right">Weighted</th>
                  <th className="px-4 py-2.5 font-medium text-right">Probability</th>
                </tr>
              </thead>
              <tbody>
                {forecast.stages.map((entry: ForecastEntry) => (
                  <tr key={entry.stageId} className="border-t border-border">
                    <td className="px-4 py-2.5 text-text-primary font-medium">{entry.stageName}</td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">{entry.dealCount}</td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">
                      {centsToFull(entry.totalValue)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">
                      {centsToFull(entry.weightedValue)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">
                      {Math.round(entry.probability * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
