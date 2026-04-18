import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDeal, useUpdateDeal, useDeleteDeal } from "../hooks/useDeals";
import { usePipeline } from "../hooks/usePipelines";
import { useContact, useContacts } from "../hooks/useContacts";
import { useCompany } from "../hooks/useCompanies";
import { useActivities, useCreateActivity } from "../hooks/useActivities";
import { Modal } from "../components/ui/Modal";
import { DealForm } from "../components/DealForm";
import { PropertyRow } from "../components/ui/PropertyRow";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Badge } from "../components/ui/Badge";
import { Input, Select, Textarea } from "../components/ui/FormField";
import { EntityTasks } from "../components/EntityTasks";
import { EntityDocuments } from "../components/EntityDocuments";
import { EntityActions } from "../components/EntityActions";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function getAgentIntelligence(deal: Deal): AgentIntelligence | null {
  const ai = deal.customFields?.agentIntelligence;
  if (!ai || typeof ai !== "object") return null;
  return ai as unknown as AgentIntelligence;
}

function riskBadgeClasses(level: string): string {
  if (level === "critical" || level === "high") return "bg-surface-red text-text-red";
  if (level === "medium") return "bg-surface-yellow text-text-yellow";
  return "bg-surface-green text-text-green";
}

/** Split narrative into bullet points by newlines or sentence boundaries. */
function narrativeBullets(narrative: string): string[] {
  // Try splitting by newlines first
  const byLines = narrative.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (byLines.length > 1) return byLines;
  // Fall back to sentence splitting
  return narrative.split(/\.\s+/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Log Activity Form
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Move Stage Dropdown
// ---------------------------------------------------------------------------

function MoveStageDropdown({ stages, currentStageId, onMove }: { stages: PipelineStage[]; currentStageId: string; onMove: (stageId: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors inline-flex items-center gap-1"
      >
        Move stage
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-48 rounded-md border border-border bg-bg shadow-lg z-20 py-1">
            {stages.map((s) => (
              <button
                key={s.id}
                disabled={s.id === currentStageId}
                onClick={() => { onMove(s.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  s.id === currentStageId
                    ? "text-text-tertiary cursor-default"
                    : "text-text-primary hover:bg-bg-hover"
                }`}
              >
                {s.name}
                {s.id === currentStageId && <span className="text-text-tertiary ml-1">(current)</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deal Detail Page
// ---------------------------------------------------------------------------

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

  // Other contacts at the same company
  const { data: companyContactsData } = useContacts(
    deal?.companyId ? { companyId: deal.companyId } : undefined,
  );
  const companyContacts = (companyContactsData?.data ?? []).filter(
    (c) => c.id !== deal?.contactId,
  );

  const { data: activitiesData } = useActivities({ dealId: id });
  const activities = activitiesData?.data ?? [];

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;
  if (!deal) return <div className="p-8 text-sm text-text-secondary">Deal not found</div>;

  const intelligence = getAgentIntelligence(deal);
  const isAtRisk = intelligence && (intelligence.riskLevel === "high" || intelligence.riskLevel === "critical");

  const handleMoveStage = (stageId: string) => {
    const targetStage = stages.find((s) => s.id === stageId);
    updateDeal.mutate({
      id: deal.id,
      stageId,
      probability: targetStage?.probability ?? deal.probability ?? undefined,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <div className="mb-2">
        <Link to="/deals" className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Deals</Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[30px] font-bold tracking-tight leading-tight">{deal.title}</h1>
            {isAtRisk && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-red text-text-red px-2.5 py-0.5 text-xs font-semibold">
                {"\u26A0"} AT RISK
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {formatCurrency(deal.value, deal.currency)}
            {stage && <> {"\u00B7"} {stage.name}</>}
            {deal.expectedCloseDate && <> {"\u00B7"} Close: {new Date(deal.expectedCloseDate).toLocaleDateString()}</>}
            {contact && <> {"\u00B7"} {contact.firstName} {contact.lastName}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stages.length > 0 && (
            <MoveStageDropdown stages={stages} currentStageId={deal.stageId} onMove={handleMoveStage} />
          )}
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
        {/* Left column: Intelligence + Timeline + Tasks */}
        <div>
          {/* Deal Intelligence */}
          <div className="bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3 mb-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Deal Intelligence</h2>
            {intelligence ? (
              <div className="space-y-4">
                {/* Agent narrative */}
                <div>
                  <div className="text-sm font-medium text-text-primary mb-2">
                    {"\uD83E\uDD16"} What I know about this deal:
                  </div>
                  <ul className="space-y-1.5 text-sm text-text-secondary">
                    {narrativeBullets(intelligence.narrative).map((bullet, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-text-tertiary shrink-0">{"\u2022"}</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Smart probability */}
                <div className="text-sm text-text-secondary">
                  <span className="font-medium text-text-primary">Win probability: {intelligence.smartProbability}%</span>
                  {deal.probability != null && intelligence.smartProbability !== deal.probability && (
                    <span className="text-text-tertiary">
                      {" "}({intelligence.smartProbability > deal.probability ? "up" : "down"} from {deal.probability}%)
                    </span>
                  )}
                </div>

                {/* Suggested next step */}
                <div className="bg-surface-blue rounded-md px-3 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">
                    Suggested next step
                  </div>
                  <div className="text-sm font-medium text-text-primary">
                    {intelligence.suggestedNextStep}
                  </div>
                </div>

                {/* Analyzed timestamp */}
                <div className="text-[11px] text-text-tertiary">
                  Last analyzed: {new Date(intelligence.analyzedAt).toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="text-sm text-text-tertiary italic">
                Pending analysis — Deal Analyst runs daily at 6 AM
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Activity Timeline</h2>
          <div className="mb-6">
            <ActivityTimeline activities={activities} />
          </div>

          {/* Pending actions for this deal */}
          <div className="mb-6">
            <EntityActions entityType="deal" entityId={deal.id} />
          </div>

          {/* Tasks */}
          <div className="mb-6">
            <EntityTasks entityType="crm_deal" entityId={deal.id} />
          </div>

          {/* Documents */}
          <div className="mb-6">
            <EntityDocuments entityType="deal" entityId={deal.id} />
          </div>
        </div>

        {/* Right column: People + Deal Details */}
        <div>
          {/* People section */}
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
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary">{contact.firstName} {contact.lastName}</div>
                  {contact.title && <div className="text-[13px] text-text-tertiary truncate">{contact.title}</div>}
                  <div className="flex items-center gap-3 text-[11px] text-text-tertiary mt-0.5">
                    {contact.email && <span>{contact.email}</span>}
                    <span>Last contact: {daysBetween(contact.updatedAt)}d ago</span>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="px-4 py-2.5 text-sm text-text-tertiary border-b border-border">No contact linked</div>
            )}
            {company ? (
              <Link
                to={`/companies/${company.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-secondary transition-colors border-b border-border"
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
              <div className="px-4 py-2.5 text-sm text-text-tertiary border-b border-border">No company linked</div>
            )}
            {/* Other contacts at the same company */}
            {companyContacts.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary bg-bg-secondary">
                  Other contacts at {company?.name ?? "company"}
                </div>
                {companyContacts.map((c) => (
                  <Link
                    key={c.id}
                    to={`/contacts/${c.id}`}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-bg-secondary transition-colors border-b border-border last:border-b-0"
                  >
                    <div className="w-6 h-6 rounded-full bg-surface-blue flex items-center justify-center text-[10px] font-medium text-text-blue shrink-0">
                      {c.firstName.charAt(0)}{c.lastName?.charAt(0) ?? ""}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-text-primary">{c.firstName} {c.lastName}</div>
                      <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                        {c.title && <span>{c.title}</span>}
                        {c.email && <span>{c.email}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </>
            )}
            {!contact && !company && companyContacts.length === 0 && (
              <div className="px-4 py-2.5 text-sm text-text-tertiary">No people linked</div>
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
            {intelligence && (
              <>
                <PropertyRow label="Smart Probability">
                  <span className="font-medium">{intelligence.smartProbability}%</span>
                  {deal.probability != null && intelligence.smartProbability !== deal.probability && (
                    <span className={`ml-1.5 text-xs ${intelligence.smartProbability > deal.probability ? "text-text-green" : "text-text-red"}`}>
                      {intelligence.smartProbability > deal.probability ? "\u2191" : "\u2193"}{Math.abs(intelligence.smartProbability - deal.probability)}%
                    </span>
                  )}
                </PropertyRow>
                <PropertyRow label="Risk Level">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeClasses(intelligence.riskLevel)}`}>
                    {intelligence.riskLevel}
                  </span>
                </PropertyRow>
              </>
            )}
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
            <PropertyRow label="Owner">{deal.ownerId}</PropertyRow>
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
