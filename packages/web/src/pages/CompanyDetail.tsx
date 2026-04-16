import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useCompany, useUpdateCompany, useDeleteCompany } from "../hooks/useCompanies";
import { useContacts } from "../hooks/useContacts";
import { useActivities } from "../hooks/useActivities";
import { useDeals } from "../hooks/useDeals";
import { Modal } from "../components/ui/Modal";
import { CompanyForm } from "../components/CompanyForm";
import { PropertyRow } from "../components/ui/PropertyRow";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Badge } from "../components/ui/Badge";
import { EntityTasks } from "../components/EntityTasks";
import { EntityDocuments } from "../components/EntityDocuments";
import type { Contact, Deal, Activity, ActivityType } from "@boringos-crm/shared";

/* ── Enrichment types ── */
interface EnrichmentField {
  value: string;
  source: string;
  confidence: string;
}

interface Enrichment {
  enrichedAt: string;
  source: "agent";
  fields: Record<string, EnrichmentField>;
}

interface AgentIntelligence {
  narrative: string;
}

/* ── Helpers ── */
function sourceBadgeColor(source: string): "blue" | "gray" | "green" {
  const s = source.toLowerCase();
  if (s.includes("linkedin")) return "blue";
  if (s.includes("web") || s.includes("website")) return "green";
  return "gray";
}

function confidenceStyle(confidence: string): string {
  switch (confidence) {
    case "high":
      return "border-solid";
    case "medium":
      return "border-dashed";
    default:
      return "border-dotted";
  }
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

const activityTypeLabels: Record<ActivityType, string> = {
  email: "emails",
  call: "calls",
  meeting: "meetings",
  note: "notes",
  task: "tasks",
};

/* ── Component ── */
export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useCompany(id!);
  const updateCompany = useUpdateCompany();
  const deleteCompany = useDeleteCompany();
  const { data: contactsData } = useContacts({ companyId: id });
  const { data: activitiesData } = useActivities({ companyId: id });
  const [showEdit, setShowEdit] = useState(false);

  const company = data?.data;
  const contacts = contactsData?.data ?? [];
  const activities = activitiesData?.data ?? [];

  // Deals at this company (client-side filter)
  const { data: allDealsData } = useDeals();
  const companyDeals = useMemo<Deal[]>(() => {
    if (!allDealsData?.data || !id) return [];
    return allDealsData.data.filter((d: Deal) => d.companyId === id);
  }, [allDealsData, id]);

  // Activity counts by type
  const activityCounts = useMemo(() => {
    const counts: Partial<Record<ActivityType, number>> = {};
    activities.forEach((a: Activity) => {
      counts[a.type] = (counts[a.type] || 0) + 1;
    });
    return counts;
  }, [activities]);

  // Extract enrichment and agent intelligence from customFields
  const enrichment = company?.customFields?.enrichment as Enrichment | undefined;
  const agentIntelligence = company?.customFields?.agentIntelligence as AgentIntelligence | undefined;

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;
  if (!company) return <div className="p-8 text-sm text-text-secondary">Company not found</div>;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link to="/companies" className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Companies</Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight leading-tight">
            {company.name}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-text-secondary flex-wrap">
            {company.industry && <span>{company.industry}</span>}
            {company.industry && (company.address || company.size) && <span>{"\u00b7"}</span>}
            {company.address && <span>{company.address}</span>}
            {company.address && company.size && <span>{"\u00b7"}</span>}
            {company.size && <span>{company.size} employees</span>}
          </div>
          {company.domain && (
            <div className="mt-1">
              <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">{company.domain}</a>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEdit(true)} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors">
            Edit
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this company?")) {
                deleteCompany.mutate(company.id, { onSuccess: () => navigate("/companies") });
              }
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-red hover:bg-surface-red transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[1fr_340px] gap-8">
        {/* ── Left column ── */}
        <div>
          {/* Company Intelligence Card */}
          <div className="mb-6">
            <h2 className="text-[11px] font-semibold text-text-blue uppercase tracking-wide mb-3">
              <span className="mr-1">&#9671;</span> Company Intelligence
            </h2>
            <div className="bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3">
              {agentIntelligence ? (
                <p className="text-sm text-text-primary whitespace-pre-line">{agentIntelligence.narrative}</p>
              ) : enrichment && Object.keys(enrichment.fields).length > 0 ? (
                /* If we have enrichment but no agent intelligence narrative, show enriched fields here */
                <div className="space-y-2">
                  {Object.entries(enrichment.fields).map(([key, field]) => (
                    <div key={key} className="flex items-start gap-2">
                      <span className="text-text-tertiary mt-0.5">&#8226;</span>
                      <div>
                        <span className="text-[12px] text-text-secondary">{formatFieldLabel(key)}:</span>{" "}
                        <span className="text-sm text-text-primary">{field.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-tertiary italic">
                  Intelligence will appear after agent processing
                </p>
              )}
            </div>
          </div>

          {/* Activity Feed */}
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Activity Feed</h2>
          <ActivityTimeline activities={activities} />
        </div>

        {/* ── Right column ── */}
        <div className="space-y-6">
          {/* Your Footprint */}
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Your Footprint</h2>
            <div className="rounded-lg border border-border p-4 space-y-3">
              {/* Deals */}
              <div>
                <span className="text-[12px] font-medium text-text-secondary block mb-1">Deals</span>
                {companyDeals.length > 0 ? (
                  <ul className="space-y-1">
                    {companyDeals.map((deal) => (
                      <li key={deal.id}>
                        <Link to={`/deals`} className="text-sm text-accent hover:underline">
                          {deal.title} ({formatCurrency(deal.value, deal.currency)})
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-tertiary">No deals</p>
                )}
              </div>

              {/* Contacts */}
              <div>
                <span className="text-[12px] font-medium text-text-secondary block mb-1">
                  Contacts: {contacts.length}
                </span>
                {contacts.length > 0 ? (
                  <ul className="space-y-1">
                    {contacts.map((c: Contact) => (
                      <li key={c.id}>
                        <Link to={`/contacts/${c.id}`} className="text-sm text-accent hover:underline">
                          {c.firstName} {c.lastName}
                          {c.title && <span className="text-text-tertiary ml-1">({c.title})</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-tertiary">No contacts</p>
                )}
              </div>

              {/* Activity summary */}
              <div>
                <span className="text-[12px] font-medium text-text-secondary block mb-1">
                  Activities: {activities.length} total
                </span>
                {activities.length > 0 && (
                  <ul className="space-y-0.5">
                    {(Object.entries(activityCounts) as [ActivityType, number][]).map(([type, count]) => (
                      <li key={type} className="text-sm text-text-secondary">
                        {count} {activityTypeLabels[type]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Enrichment */}
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Enrichment</h2>
            <div className="rounded-lg border border-border p-4">
              {enrichment && Object.keys(enrichment.fields).length > 0 ? (
                <>
                  <div className="space-y-2.5">
                    {Object.entries(enrichment.fields).map(([key, field]) => (
                      <div key={key} className={`flex items-start justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0 ${confidenceStyle(field.confidence)}`}>
                        <div>
                          <span className="text-[12px] text-text-secondary block">{formatFieldLabel(key)}</span>
                          <span className="text-sm text-text-primary">{field.value}</span>
                        </div>
                        <Badge color={sourceBadgeColor(field.source)}>{field.source}</Badge>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-text-tertiary">
                    Enriched by agent {"\u00b7"} {new Date(enrichment.enrichedAt).toLocaleDateString()}
                  </p>
                </>
              ) : (
                <p className="text-sm text-text-tertiary italic">Awaiting enrichment...</p>
              )}
            </div>
          </div>

          {/* Details */}
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Details</h2>
            <div className="rounded-lg border border-border p-4">
              <PropertyRow label="Domain">
                {company.domain ? <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">{company.domain}</a> : "\u2014"}
              </PropertyRow>
              <PropertyRow label="Industry">
                {company.industry ? <Badge color="gray">{company.industry}</Badge> : "\u2014"}
              </PropertyRow>
              <PropertyRow label="Size">{company.size || "\u2014"}</PropertyRow>
              <PropertyRow label="Website">
                {company.website ? <a href={company.website} target="_blank" rel="noreferrer" className="text-accent hover:underline">{company.website}</a> : "\u2014"}
              </PropertyRow>
              <PropertyRow label="Address">{company.address || "\u2014"}</PropertyRow>
              <PropertyRow label="Created">
                {new Date(company.createdAt).toLocaleDateString()}
              </PropertyRow>
            </div>
          </div>

          {/* Tasks */}
          <div>
            <EntityTasks entityType="crm_company" entityId={company.id} />
          </div>

          {/* Documents */}
          <div>
            <EntityDocuments entityType="company" entityId={company.id} />
          </div>
        </div>
      </div>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Company">
        <CompanyForm
          initial={company}
          onSubmit={(data) => {
            updateCompany.mutate({ ...data, id: company.id }, { onSuccess: () => setShowEdit(false) });
          }}
          onCancel={() => setShowEdit(false)}
          loading={updateCompany.isPending}
        />
      </Modal>
    </div>
  );
}
