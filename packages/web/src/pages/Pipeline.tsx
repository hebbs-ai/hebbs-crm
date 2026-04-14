import { useState, useMemo, useCallback, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { usePipelines, usePipeline } from "../hooks/usePipelines";
import { useDeals, useForecast, useUpdateDeal } from "../hooks/useDeals";
import { useContacts } from "../hooks/useContacts";
import type { Deal, PipelineStage } from "@boringos-crm/shared";

// ---------------------------------------------------------------------------
// Agent Intelligence type
// ---------------------------------------------------------------------------

interface AgentIntelligence {
  riskLevel: "low" | "medium" | "high" | "critical";
  signals: string[];
  narrative: string;
  suggestedNextStep: string;
  smartProbability: number;
  analyzedAt: string;
}

function getAgentIntelligence(deal: Deal): AgentIntelligence | null {
  const ai = deal.customFields?.agentIntelligence;
  if (!ai || typeof ai !== "object") return null;
  return ai as unknown as AgentIntelligence;
}

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
// Signal tag helpers
// ---------------------------------------------------------------------------

function signalTagColor(signal: string): string {
  const lower = signal.toLowerCase();
  if (lower.includes("silent") || lower.includes("overdue")) return "bg-surface-red text-text-red";
  if (lower.includes("blocker")) return "bg-surface-yellow text-text-yellow";
  if (lower.includes("closing") || lower.includes("ready")) return "bg-surface-green text-text-green";
  return "bg-bg-hover text-text-tertiary";
}

// ---------------------------------------------------------------------------
// Deal Card
// ---------------------------------------------------------------------------

function DealCard({
  deal,
  contactName,
  onDragStart,
}: {
  deal: Deal;
  contactName: string | null;
  onDragStart: (e: DragEvent, deal: Deal) => void;
}) {
  const days = daysSince(deal.updatedAt);
  const intelligence = getAgentIntelligence(deal);
  const isAtRisk = intelligence && (intelligence.riskLevel === "high" || intelligence.riskLevel === "critical");
  const signals = intelligence?.signals ?? [];

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal)}
      className="border border-border rounded-md p-3 bg-bg hover:shadow-sm hover:border-border-dark transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <Link
          to={`/deals/${deal.id}`}
          className="font-semibold text-sm text-text-primary hover:underline block"
        >
          {deal.title}
        </Link>
        {isAtRisk && (
          <span className="text-text-red text-xs shrink-0" title={`Risk: ${intelligence.riskLevel}`}>
            {"\u26A0"}
          </span>
        )}
      </div>

      <div className="text-[13px] text-text-secondary mb-1">
        {formatValueFull(deal.value)}
      </div>

      {contactName && (
        <div className="text-[11px] text-text-tertiary mb-1.5 truncate">
          {contactName}
        </div>
      )}

      {/* Signal tags */}
      {signals.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {signals.map((signal, i) => (
            <span
              key={i}
              className={`inline-block text-[10px] font-medium rounded-full px-1.5 py-0.5 leading-none ${signalTagColor(signal)}`}
            >
              {signal}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          {intelligence
            ? `${intelligence.smartProbability}%`
            : deal.probability != null
              ? `${deal.probability}%`
              : ""}
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
  contactMap,
  onDragStart,
  onDrop,
}: {
  stage: PipelineStage;
  deals: Deal[];
  contactMap: Map<string, string>;
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
          <DealCard
            key={deal.id}
            deal={deal}
            contactName={deal.contactId ? (contactMap.get(deal.contactId) ?? null) : null}
            onDragStart={onDragStart}
          />
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
// Agent Notes Section
// ---------------------------------------------------------------------------

function AgentNotesSection({ deals, forecast }: { deals: Deal[]; forecast: { totalWeightedValue: number } | undefined }) {
  const dealsWithIntel = deals.filter((d) => getAgentIntelligence(d) !== null);
  const atRiskDeals = dealsWithIntel.filter((d) => {
    const intel = getAgentIntelligence(d)!;
    return intel.riskLevel === "high" || intel.riskLevel === "critical";
  });

  if (dealsWithIntel.length === 0) {
    return (
      <div className="mt-4 bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3">
        <div className="text-sm font-medium text-text-primary mb-1">
          {"\uD83E\uDD16"} Agent Notes on this Pipeline
        </div>
        <div className="text-[13px] text-text-tertiary italic">
          Deal Analyst runs daily at 6 AM — pipeline notes will appear here
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3">
      <div className="text-sm font-medium text-text-primary mb-2">
        {"\uD83E\uDD16"} Agent Notes on this Pipeline
      </div>

      {atRiskDeals.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">
            At-risk deals ({atRiskDeals.length})
          </div>
          <ul className="space-y-1.5">
            {atRiskDeals.map((deal) => {
              const intel = getAgentIntelligence(deal)!;
              return (
                <li key={deal.id} className="flex items-start gap-2 text-[13px]">
                  <span className="text-text-red shrink-0">{"\u26A0"}</span>
                  <div>
                    <Link to={`/deals/${deal.id}`} className="font-medium text-text-primary hover:underline">
                      {deal.title}
                    </Link>
                    <span className="text-text-secondary ml-1.5">
                      — {intel.signals.join(", ")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {forecast && (
        <div className="text-[13px] text-text-secondary">
          Pipeline weighted value: <strong className="text-text-primary">{formatValueFull(forecast.totalWeightedValue)}</strong>
          {atRiskDeals.length > 0 && (
            <span className="text-text-tertiary">
              {" "}({atRiskDeals.length} deal{atRiskDeals.length !== 1 ? "s" : ""} at risk)
            </span>
          )}
        </div>
      )}
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

  // Fetch contacts for deal cards
  const { data: contactsRes } = useContacts();
  const contactMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of contactsRes?.data ?? []) {
      map.set(c.id, `${c.firstName} ${c.lastName}`);
    }
    return map;
  }, [contactsRes]);

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
              contactMap={contactMap}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Agent Notes Section */}
      <AgentNotesSection deals={deals} forecast={forecast} />
    </div>
  );
}
