// SPDX-License-Identifier: GPL-3.0-or-later
//
// "Pipeline by stage" — second CRM contribution to the shell Home
// dashboard (task_26). Shows the open-stage breakdown of the
// tenant's default pipeline: deal count per stage as a horizontal
// bar, weighted forecast total in the header.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { tool } from "../lib/api.js";

interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
}

interface ForecastStage {
  stageId: string;
  stageName: string;
  dealCount: number;
  totalValue: number;
  weightedValue: number;
  probability: number;
}

interface ForecastResponse {
  data: {
    pipelineId: string;
    pipelineName: string;
    totalWeightedValue: number;
    stages: ForecastStage[];
  };
}

function formatUsd(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

export function PipelineByStageWidget() {
  const pipelinesQuery = useQuery({
    queryKey: ["crm.dashboard.pipelines"],
    queryFn: () => tool<{ data: Pipeline[] }>("crm.pipelines.list", {}),
    staleTime: 5 * 60_000,
  });

  const pipelines = pipelinesQuery.data?.data ?? [];
  const defaultPipeline =
    pipelines.find((p) => p.isDefault) ?? pipelines[0];

  const forecastQuery = useQuery({
    queryKey: ["crm.dashboard.forecast", defaultPipeline?.id],
    queryFn: () =>
      tool<ForecastResponse>("crm.pipelines.forecast", { id: defaultPipeline!.id }),
    enabled: !!defaultPipeline?.id,
    staleTime: 60_000,
  });

  const isLoading = pipelinesQuery.isLoading || forecastQuery.isLoading;
  const isError = pipelinesQuery.isError || forecastQuery.isError;
  const forecast = forecastQuery.data?.data;
  const stages = forecast?.stages ?? [];
  const maxCount = Math.max(1, ...stages.map((s) => s.dealCount));

  return (
    <div className="rounded-lg border border-border bg-white p-4 h-full">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-muted">
          Pipeline by stage
        </div>
        <div className="text-sm font-medium text-text">
          {isLoading
            ? "…"
            : forecast
              ? formatUsd(forecast.totalWeightedValue)
              : ""}
        </div>
      </div>
      {isError ? (
        <div className="mt-3 text-xs text-muted">Couldn't load pipeline.</div>
      ) : !isLoading && stages.length === 0 ? (
        <div className="mt-3 text-sm text-muted">No open stages.</div>
      ) : (
        <ul className="mt-3 space-y-2">
          {stages.map((s) => {
            const width = Math.max(2, Math.round((s.dealCount / maxCount) * 100));
            return (
              <li key={s.stageId} className="text-sm">
                <div className="flex items-center justify-between">
                  <Link
                    to={`/pipeline?stage=${s.stageId}`}
                    className="text-text truncate hover:underline"
                  >
                    {s.stageName}
                  </Link>
                  <span className="text-xs text-muted whitespace-nowrap">
                    {s.dealCount} · {formatUsd(s.totalValue)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-sm bg-border/40 overflow-hidden">
                  <div
                    className="h-full bg-accent/70"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
