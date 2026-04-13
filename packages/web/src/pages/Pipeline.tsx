import { useState, useMemo, useCallback, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { usePipelines, usePipeline } from "../hooks/usePipelines";
import { useDeals, useForecast, useUpdateDeal } from "../hooks/useDeals";
import type { Deal, PipelineStage } from "@boringos-crm/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatValue(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}k`;
  return currencyFmt.format(dollars);
}

function formatValueFull(cents: number): string {
  return currencyFmt.format(cents / 100);
}

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function signalText(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function signalColor(days: number): string {
  if (days <= 3) return "text-text-secondary";
  if (days <= 7) return "text-yellow-600";
  return "text-red-600";
}

// ---------------------------------------------------------------------------
// Deal Card
// ---------------------------------------------------------------------------

function DealCard({ deal, onDragStart }: { deal: Deal; onDragStart: (e: DragEvent, deal: Deal) => void }) {
  const days = daysSince(deal.updatedAt);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal)}
      className="border border-border rounded-md p-3 bg-bg hover:shadow-sm hover:border-border-dark transition-all cursor-grab active:cursor-grabbing"
    >
      <Link
        to={`/deals/${deal.id}`}
        className="font-semibold text-sm text-text-primary hover:underline block mb-0.5"
      >
        {deal.title}
      </Link>
      <div className="text-[13px] text-text-secondary mb-1.5">
        {formatValueFull(deal.value)}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          {deal.probability != null ? `${Math.round(deal.probability * 100)}%` : ""}
        </span>
        <span className={`text-xs ${signalColor(days)}`}>
          {signalText(days)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage Column
// ---------------------------------------------------------------------------

function StageColumn({
  stage,
  deals,
  onDragStart,
  onDrop,
}: {
  stage: PipelineStage;
  deals: Deal[];
  onDragStart: (e: DragEvent, deal: Deal) => void;
  onDrop: (e: DragEvent, stage: PipelineStage) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      onDrop(e, stage);
    },
    [onDrop, stage],
  );

  return (
    <div
      className={`flex-1 min-w-[200px] max-w-[260px] ${dragOver ? "opacity-80" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex justify-between items-center px-3 py-2 text-xs font-semibold text-text-secondary border-b-2 border-border-dark mb-2">
        <span>
          {stage.name}{" "}
          <span className="font-normal text-text-tertiary">{deals.length}</span>
        </span>
        <span className="font-semibold text-text-primary">{formatValue(totalValue)}</span>
      </div>

      {/* Deal cards */}
      <div className="space-y-1.5">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onDragStart={onDragStart} />
        ))}
        {deals.length === 0 && (
          <div className="text-xs text-text-tertiary px-3 py-6 text-center">
            No deals
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Page
// ---------------------------------------------------------------------------

export function PipelinePage() {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");

  // Fetch all pipelines
  const { data: pipelinesRes, isLoading: pipelinesLoading } = usePipelines();
  const pipelines = pipelinesRes?.data ?? [];

  // Auto-select default pipeline
  const activePipelineId = useMemo(() => {
    if (selectedPipelineId) return selectedPipelineId;
    const defaultPl = pipelines.find((p) => p.isDefault);
    return defaultPl?.id ?? pipelines[0]?.id ?? "";
  }, [selectedPipelineId, pipelines]);

  // Fetch selected pipeline (with stages) and its deals
  const { data: pipelineRes, isLoading: pipelineLoading } = usePipeline(activePipelineId);
  const pipeline = pipelineRes?.data;
  const stages = useMemo(
    () => (pipeline?.stages ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [pipeline],
  );

  const { data: dealsRes, isLoading: dealsLoading } = useDeals(
    activePipelineId ? { pipelineId: activePipelineId } : undefined,
  );
  const deals = dealsRes?.data ?? [];

  // Forecast
  const { data: forecastRes } = useForecast(activePipelineId);
  const forecast = forecastRes?.data;

  // Group deals by stage
  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of stages) {
      map.set(stage.id, []);
    }
    for (const deal of deals) {
      const list = map.get(deal.stageId);
      if (list) list.push(deal);
    }
    return map;
  }, [deals, stages]);

  // Summary stats
  const totalDeals = deals.length;
  const closingThisWeek = useMemo(() => {
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    return deals.filter((d) => {
      if (!d.expectedCloseDate) return false;
      const close = new Date(d.expectedCloseDate);
      return close >= now && close <= endOfWeek;
    }).length;
  }, [deals]);

  // Drag-and-drop
  const updateDeal = useUpdateDeal();

  const handleDragStart = useCallback((e: DragEvent, deal: Deal) => {
    e.dataTransfer.setData("text/plain", deal.id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent, stage: PipelineStage) => {
      const dealId = e.dataTransfer.getData("text/plain");
      if (!dealId) return;

      // Don't update if dropped on same stage
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stageId === stage.id) return;

      updateDeal.mutate({
        id: dealId,
        stageId: stage.id,
        probability: stage.probability,
      });
    },
    [deals, updateDeal],
  );

  // Loading state
  const isLoading = pipelinesLoading || pipelineLoading || dealsLoading;

  if (pipelinesLoading) {
    return (
      <div className="px-8 py-6">
        <div className="text-sm text-text-secondary">Loading pipelines...</div>
      </div>
    );
  }

  return (
    <div className="px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-4">
          {/* Pipeline selector */}
          <select
            value={activePipelineId}
            onChange={(e) => setSelectedPipelineId(e.target.value)}
            className="text-[24px] font-bold tracking-tight leading-tight bg-transparent border-none outline-none cursor-pointer text-text-primary appearance-none pr-6"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 0 center",
            }}
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <span className="text-sm text-text-secondary">
            {forecast
              ? `${formatValueFull(forecast.totalWeightedValue)} weighted`
              : isLoading
                ? "..."
                : ""}{" "}
            · {totalDeals} deal{totalDeals !== 1 ? "s" : ""}
            {closingThisWeek > 0 && ` · ${closingThisWeek} closing this week`}
          </span>
        </div>

        <div className="flex gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-medium border border-border bg-bg-hover transition-colors">
            My deals
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-medium border border-border bg-bg hover:bg-bg-hover transition-colors">
            Team
          </button>
          <span className="border-l border-border mx-1" />
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-medium border border-border bg-bg hover:bg-bg-hover transition-colors">
            Forecast
          </button>
        </div>
      </div>

      {/* Kanban board */}
      {isLoading ? (
        <div className="text-sm text-text-secondary py-8">Loading deals...</div>
      ) : stages.length === 0 ? (
        <div className="text-sm text-text-secondary py-8">
          No stages configured for this pipeline.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={dealsByStage.get(stage.id) ?? []}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Agent Notes placeholder */}
      <div className="mt-4 border border-border rounded-md p-4 bg-bg">
        <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
          Pipeline Intelligence
        </div>
        <div className="text-[13px] text-text-secondary leading-relaxed">
          Agent notes will appear here with insights about at-risk deals, engagement signals, and forecast confidence.
        </div>
      </div>
    </div>
  );
}
