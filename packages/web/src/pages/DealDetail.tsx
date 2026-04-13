import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDeal, useUpdateDeal, useDeleteDeal } from "../hooks/useDeals";
import { usePipeline } from "../hooks/usePipelines";
import { useContact } from "../hooks/useContacts";
import { useCompany } from "../hooks/useCompanies";
import { useActivities, useCreateActivity } from "../hooks/useActivities";
import { Modal } from "../components/ui/Modal";
import { DealForm } from "../components/DealForm";
import { PropertyRow } from "../components/ui/PropertyRow";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Badge } from "../components/ui/Badge";
import { Input, Select, Textarea } from "../components/ui/FormField";
import { EntityTasks } from "../components/EntityTasks";
import type { Deal } from "@boringos-crm/shared";

function formatCurrency(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

function stageBadgeColor(type?: string): "blue" | "green" | "red" {
  if (type === "won") return "green";
  if (type === "lost") return "red";
  return "blue";
}

function daysBetween(from: string, to: Date = new Date()): number {
  const diff = to.getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function LogActivityForm({ dealId, contactId, onSuccess, onCancel }: { dealId: string; contactId: string | null; onSuccess: () => void; onCancel: () => void }) {
  const createActivity = useCreateActivity();
  const [form, setForm] = useState({ type: "call", subject: "", body: "" });
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createActivity.mutate(
      {
        dealId,
        contactId: contactId || undefined,
        type: form.type as "call" | "email" | "meeting" | "note",
        subject: form.subject,
        body: form.body || undefined,
        occurredAt: new Date().toISOString(),
      } as Partial<import("@boringos-crm/shared").Activity>,
      { onSuccess },
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <Select
        label="Type"
        value={form.type}
        onChange={(e) => set("type", (e.target as HTMLSelectElement).value)}
        options={[
          { value: "call", label: "Call" },
          { value: "email", label: "Email" },
          { value: "meeting", label: "Meeting" },
          { value: "note", label: "Note" },
        ]}
      />
      <Input label="Subject" value={form.subject} onChange={(e) => set("subject", (e.target as HTMLInputElement).value)} required className="mt-3" />
      <Textarea label="Body" value={form.body} onChange={(e) => set("body", (e.target as HTMLTextAreaElement).value)} className="mt-3" />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={createActivity.isPending} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
          {createActivity.isPending ? "Saving..." : "Log Activity"}
        </button>
      </div>
    </form>
  );
}

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useDeal(id!);
  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();
  const [showEdit, setShowEdit] = useState(false);
  const [showLogActivity, setShowLogActivity] = useState(false);

  const deal: Deal | undefined = data?.data;

  const { data: pipelineData } = usePipeline(deal?.pipelineId ?? "");
  const pipeline = pipelineData?.data;
  const stages = pipeline?.stages ?? [];
  const stage = stages.find((s) => s.id === deal?.stageId);

  const { data: contactData } = useContact(deal?.contactId ?? "");
  const contact = contactData?.data;

  const { data: companyData } = useCompany(deal?.companyId ?? "");
  const company = companyData?.data;

  const { data: activitiesData } = useActivities({ dealId: id });
  const activities = activitiesData?.data ?? [];

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;
  if (!deal) return <div className="p-8 text-sm text-text-secondary">Deal not found</div>;

  const daysInStage = daysBetween(deal.updatedAt);
  const lastActivity = activities.length > 0 ? activities[0] : null;
  const daysSinceLastActivity = lastActivity ? daysBetween(lastActivity.occurredAt ?? lastActivity.createdAt) : null;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <div className="mb-2">
        <Link to="/deals" className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Deals</Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight leading-tight">{deal.title}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {formatCurrency(deal.value, deal.currency)}
            {stage && <> {"\u00B7"} {stage.name}</>}
            {deal.expectedCloseDate && <> {"\u00B7"} Close: {new Date(deal.expectedCloseDate).toLocaleDateString()}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLogActivity(true)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors">
            Log Activity
          </button>
          <button onClick={() => setShowEdit(true)} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors">
            Edit
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this deal?")) {
                deleteDeal.mutate(deal.id, { onSuccess: () => navigate("/deals") });
              }
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-red hover:bg-surface-red transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-8">
        {/* Left: Deal Intelligence + Activity Timeline */}
        <div>
          {/* Deal Intelligence */}
          <div className="rounded-lg border border-border p-4 mb-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Deal Intelligence</h2>
            <div className="space-y-2 text-sm text-text-secondary">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-surface-blue shrink-0"></span>
                <span>
                  <strong className="text-text-primary">{daysInStage} day{daysInStage !== 1 ? "s" : ""}</strong> in current stage
                  {stage && <> ({stage.name})</>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${daysSinceLastActivity !== null && daysSinceLastActivity > 7 ? "bg-surface-red" : "bg-surface-green"}`}></span>
                <span>
                  {daysSinceLastActivity !== null ? (
                    <>
                      <strong className="text-text-primary">{daysSinceLastActivity} day{daysSinceLastActivity !== 1 ? "s" : ""}</strong> since last activity
                    </>
                  ) : (
                    <span className="text-text-tertiary">No activities logged yet</span>
                  )}
                </span>
              </div>
              {deal.probability != null && (
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-surface-purple shrink-0"></span>
                  <span>Win probability: <strong className="text-text-primary">{deal.probability}%</strong></span>
                </div>
              )}
            </div>
          </div>

          {/* Tasks */}
          <div className="mb-6">
            <EntityTasks entityType="crm_deal" entityId={deal.id} />
          </div>

          {/* Activity Timeline */}
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Activity Timeline</h2>
          <ActivityTimeline activities={activities} />
        </div>

        {/* Right: People + Deal Details */}
        <div>
          {/* People */}
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">People</h2>
          <div className="rounded-lg border border-border mb-6">
            {contact ? (
              <Link
                to={`/contacts/${contact.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-secondary transition-colors border-b border-border"
              >
                <div className="w-7 h-7 rounded-full bg-surface-blue flex items-center justify-center text-[11px] font-medium text-text-blue shrink-0">
                  {contact.firstName.charAt(0)}{contact.lastName?.charAt(0) ?? ""}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">{contact.firstName} {contact.lastName}</div>
                  {contact.title && <div className="text-[13px] text-text-tertiary truncate">{contact.title}</div>}
                </div>
              </Link>
            ) : (
              <div className="px-4 py-2.5 text-sm text-text-tertiary border-b border-border">No contact linked</div>
            )}
            {company ? (
              <Link
                to={`/companies/${company.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-secondary transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-surface-purple flex items-center justify-center text-[11px] font-medium text-text-purple shrink-0">
                  {company.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">{company.name}</div>
                  {company.industry && <div className="text-[13px] text-text-tertiary truncate">{company.industry}</div>}
                </div>
              </Link>
            ) : (
              <div className="px-4 py-2.5 text-sm text-text-tertiary">No company linked</div>
            )}
          </div>

          {/* Deal Details */}
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Deal Details</h2>
          <div className="rounded-lg border border-border p-4">
            <PropertyRow label="Value">
              <strong>{formatCurrency(deal.value, deal.currency)}</strong>
            </PropertyRow>
            <PropertyRow label="Stage">
              {stage ? <Badge color={stageBadgeColor(stage.type)}>{stage.name}</Badge> : "\u2014"}
            </PropertyRow>
            <PropertyRow label="Probability">
              {deal.probability != null ? `${deal.probability}%` : "\u2014"}
            </PropertyRow>
            <PropertyRow label="Pipeline">
              {pipeline?.name ?? "\u2014"}
            </PropertyRow>
            <PropertyRow label="Expected Close">
              {deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : "\u2014"}
            </PropertyRow>
            <PropertyRow label="Contact">
              {contact ? (
                <Link to={`/contacts/${contact.id}`} className="text-accent hover:underline">
                  {contact.firstName} {contact.lastName}
                </Link>
              ) : "\u2014"}
            </PropertyRow>
            <PropertyRow label="Company">
              {company ? (
                <Link to={`/companies/${company.id}`} className="text-accent hover:underline">
                  {company.name}
                </Link>
              ) : "\u2014"}
            </PropertyRow>
            <PropertyRow label="Currency">{deal.currency}</PropertyRow>
            {deal.lostReason && (
              <PropertyRow label="Lost Reason">
                <span className="text-text-red">{deal.lostReason}</span>
              </PropertyRow>
            )}
            <PropertyRow label="Created">
              {new Date(deal.createdAt).toLocaleDateString()}
            </PropertyRow>
          </div>
        </div>
      </div>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Deal">
        <DealForm
          initial={deal}
          onSubmit={(data) => {
            updateDeal.mutate({ ...data, id: deal.id } as Partial<Deal> & { id: string }, { onSuccess: () => setShowEdit(false) });
          }}
          onCancel={() => setShowEdit(false)}
          loading={updateDeal.isPending}
        />
      </Modal>

      <Modal open={showLogActivity} onClose={() => setShowLogActivity(false)} title="Log Activity">
        <LogActivityForm
          dealId={deal.id}
          contactId={deal.contactId}
          onSuccess={() => setShowLogActivity(false)}
          onCancel={() => setShowLogActivity(false)}
        />
      </Modal>
    </div>
  );
}
