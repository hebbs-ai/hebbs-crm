// SPDX-License-Identifier: BUSL-1.1
//
// "Deals closing this week" — first CRM contribution to the shell
// Home dashboard (task_26). Lists open deals with expectedCloseDate
// within the next 7 days, ordered by date.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { tool } from "../lib/api.js";

interface DealRow {
  id: string;
  title: string;
  value: number;
  currency: string;
  expectedCloseDate: string | null;
  stageId: string;
}

interface DealsListResponse {
  data: DealRow[];
}

function formatCurrency(value: number, currency: string): string {
  const dollars = value / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(0)}`;
  }
}

function daysFromNow(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.round((target - now) / (24 * 3600 * 1000));
}

export function DealsClosingThisWeekWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm.dashboard.deals-closing"],
    queryFn: () => tool<DealsListResponse>("crm.deals.list", { limit: 200 }),
    staleTime: 60_000,
  });

  const upcoming = useMemo(() => {
    const rows = data?.data ?? [];
    const now = Date.now();
    const horizon = now + 7 * 24 * 3600 * 1000;
    return rows
      .filter((d) => {
        if (!d.expectedCloseDate) return false;
        const t = new Date(d.expectedCloseDate).getTime();
        return Number.isFinite(t) && t >= now && t <= horizon;
      })
      .sort(
        (a, b) =>
          new Date(a.expectedCloseDate!).getTime() -
          new Date(b.expectedCloseDate!).getTime(),
      );
  }, [data]);

  return (
    <div className="rounded-lg border border-border bg-white p-4 h-full">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-muted">
          Closing this week
        </div>
        <div className="text-sm font-medium text-text">
          {isLoading ? "…" : upcoming.length}
        </div>
      </div>
      {isError ? (
        <div className="mt-3 text-xs text-muted">Couldn't load deals.</div>
      ) : upcoming.length === 0 && !isLoading ? (
        <div className="mt-3 text-sm text-muted">Nothing closing this week.</div>
      ) : (
        <ul className="mt-3 space-y-2">
          {upcoming.slice(0, 3).map((d) => (
            <li
              key={d.id}
              className="flex items-start justify-between gap-3 text-sm"
            >
              <Link
                to={`/deals/${d.id}`}
                className="text-text truncate hover:underline"
              >
                {d.title}
              </Link>
              <span className="text-xs text-muted whitespace-nowrap">
                {formatCurrency(d.value, d.currency)} ·{" "}
                {daysFromNow(d.expectedCloseDate!) === 0
                  ? "today"
                  : `${daysFromNow(d.expectedCloseDate!)}d`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
