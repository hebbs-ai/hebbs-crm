import { useState } from "react";
import { Link } from "react-router-dom";
import { useDeals, useCreateDeal, useDeleteDeal } from "../hooks/useDeals";
import { usePipelines, usePipeline } from "../hooks/usePipelines";
import { useContacts } from "../hooks/useContacts";
import { Modal } from "../components/ui/Modal";
import { DealForm } from "../components/DealForm";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchInput } from "../components/ui/SearchInput";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import type { Deal, Contact, PipelineStage } from "@boringos-crm/shared";

function formatCurrency(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

function stageBadgeColor(type?: string): "blue" | "green" | "red" {
  if (type === "won") return "green";
  if (type === "lost") return "red";
  return "blue";
}

export function DealsPage() {
  const [search, setSearch] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: pipelinesData } = usePipelines();
  const pipelines = pipelinesData?.data ?? [];

  const { data, isLoading } = useDeals({
    search: search || undefined,
    pipelineId: pipelineFilter || undefined,
  });
  const createDeal = useCreateDeal();
  const deleteDeal = useDeleteDeal();

  const deals = data?.data ?? [];

  // Load the selected pipeline (or default) to get stage info
  const activePipelineId = pipelineFilter || (pipelines.length > 0 ? pipelines[0].id : "");
  const { data: pipelineData } = usePipeline(activePipelineId);
  const stagesMap = new Map<string, PipelineStage>();
  (pipelineData?.data?.stages ?? []).forEach((s) => stagesMap.set(s.id, s));

  // Also load all pipelines' stages for deals that may be in different pipelines
  // We'll use a simple approach: display stage name from our map, fall back to stageId

  const { data: contactsData } = useContacts();
  const contactsMap = new Map<string, Contact>();
  (contactsData?.data ?? []).forEach((c) => contactsMap.set(c.id, c));

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Deals"
        subtitle={`${deals.length} deal${deals.length !== 1 ? "s" : ""}`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            + New Deal
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search deals..." />
        <select
          value={pipelineFilter}
          onChange={(e) => setPipelineFilter(e.target.value)}
          className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
        >
          <option value="">All pipelines</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary py-8 text-center">Loading...</p>
      ) : deals.length === 0 ? (
        <EmptyState
          title="No deals yet"
          description={search ? "Try a different search term" : "Create your first deal to get started"}
          action={!search ? { label: "New Deal", onClick: () => setShowCreate(true) } : undefined}
        />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Title</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Value</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Stage</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Contact</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Close Date</th>
              <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border w-20"></th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d: Deal) => {
              const stage = stagesMap.get(d.stageId);
              const contact = d.contactId ? contactsMap.get(d.contactId) : null;
              return (
                <tr key={d.id} className="hover:bg-bg-secondary transition-colors">
                  <td className="px-3 py-2.5 border-b border-border">
                    <Link to={`/deals/${d.id}`} className="font-medium text-text-primary hover:text-accent">
                      {d.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">
                    {formatCurrency(d.value, d.currency)}
                  </td>
                  <td className="px-3 py-2.5 border-b border-border">
                    {stage ? (
                      <Badge color={stageBadgeColor(stage.type)}>{stage.name}</Badge>
                    ) : (
                      <span className="text-sm text-text-tertiary">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">
                    {contact ? `${contact.firstName} ${contact.lastName}` : "\u2014"}
                  </td>
                  <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">
                    {d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString() : "\u2014"}
                  </td>
                  <td className="px-3 py-2.5 border-b border-border text-right">
                    <button
                      onClick={() => { if (confirm("Delete this deal?")) deleteDeal.mutate(d.id); }}
                      className="text-xs text-text-tertiary hover:text-text-red transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Deal">
        <DealForm
          onSubmit={(data) => {
            createDeal.mutate(data, { onSuccess: () => setShowCreate(false) });
          }}
          onCancel={() => setShowCreate(false)}
          loading={createDeal.isPending}
        />
      </Modal>
    </div>
  );
}
