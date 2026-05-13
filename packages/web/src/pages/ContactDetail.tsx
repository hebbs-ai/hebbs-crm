import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useContact, useUpdateContact, useDeleteContact, useContacts } from "../hooks/useContacts";
import { useActivities } from "../hooks/useActivities";
import { useCompany } from "../hooks/useCompanies";
import { useDeals } from "../hooks/useDeals";
import { tool } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../components/ui/Modal";
import { ContactForm } from "../components/ContactForm";
import { PropertyRow } from "../components/ui/PropertyRow";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Badge } from "../components/ui/Badge";
import { EntityTasks } from "../components/EntityTasks";
import { ContactDossierView } from "../components/DossierView";
import { EntityActions } from "../components/EntityActions";
import type { Deal, Contact, ContactDossier } from "@boringos-crm/shared";
import { isContactDossier } from "@boringos-crm/shared";

/* ── Legacy enrichment types (backward compat) ── */
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

interface AgentInsights {
  summary: string;
  traits: string[];
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

/* ── Component ── */
export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useContact(id!);
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const { data: activitiesData } = useActivities({ contactId: id });
  const [showEdit, setShowEdit] = useState(false);

  const contact = data?.data;
  const companyId = contact?.companyId ?? "";
  const { data: companyData } = useCompany(companyId);
  const company = companyData?.data;
  const activities = activitiesData?.data ?? [];

  // Deals linked to this contact (client-side filter)
  const { data: allDealsData } = useDeals();
  const contactDeals = useMemo<Deal[]>(() => {
    if (!allDealsData?.data || !id) return [];
    return allDealsData.data.filter((d: Deal) => d.contactId === id || d.companyId === companyId);
  }, [allDealsData, id, companyId]);

  const contactOpenDeals = useMemo<Deal[]>(
    () => contactDeals.filter((d) => d.contactId === id),
    [contactDeals, id],
  );

  const queryClient = useQueryClient();
  const [promoting, setPromoting] = useState(false);

  const handlePromote = async () => {
    if (!id) return;
    setPromoting(true);
    try {
      const result = await tool<{ dealId: string; created: boolean }>(
        "crm.contacts.promote_to_deal",
        { contactId: id, source: "manual" },
      );
      await queryClient.invalidateQueries({ queryKey: ["deals"] });
      await queryClient.invalidateQueries({ queryKey: ["activities"] });
      navigate(`/deals/${result.dealId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create deal");
    } finally {
      setPromoting(false);
    }
  };

  // Other contacts at the same company
  const { data: siblingContactsData } = useContacts(companyId ? { companyId } : undefined);
  const siblingContacts = useMemo<Contact[]>(() => {
    if (!siblingContactsData?.data || !id) return [];
    return siblingContactsData.data.filter((c: Contact) => c.id !== id);
  }, [siblingContactsData, id]);

  // Extract dossier, legacy enrichment, and agent insights from customFields
  const dossier = contact?.customFields?.dossier as ContactDossier | undefined;
  const hasDossier = isContactDossier(dossier);
  const enrichment = contact?.customFields?.enrichment as Enrichment | undefined;
  const agentInsights = contact?.customFields?.agentInsights as AgentInsights | undefined;

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;
  if (!contact) return <div className="p-8 text-sm text-text-secondary">Contact not found</div>;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link to="/contacts" className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Contacts</Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight leading-tight">
            {contact.firstName} {contact.lastName}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-text-secondary flex-wrap">
            {contact.title && company && (
              <span>
                {contact.title} at{" "}
                <Link to={`/companies/${company.id}`} className="text-accent hover:underline">{company.name}</Link>
              </span>
            )}
            {contact.title && !company && <span>{contact.title}</span>}
          </div>
          {/* Quick contact info row */}
          <div className="mt-2 flex items-center gap-3 text-[13px] text-text-secondary flex-wrap">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="hover:text-text-primary">
                <span className="mr-1">&#9993;</span>{contact.email}
              </a>
            )}
            {contact.phone && (
              <span><span className="mr-1">&#128222;</span>{contact.phone}</span>
            )}
            {contact.linkedIn && (
              <a href={contact.linkedIn} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                LinkedIn
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contactOpenDeals.length === 0 && (
            <button
              onClick={handlePromote}
              disabled={promoting}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {promoting ? "Creating…" : "Promote to deal"}
            </button>
          )}
          <button onClick={() => setShowEdit(true)} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors">
            Edit
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this contact?")) {
                deleteContact.mutate(contact.id, { onSuccess: () => navigate("/contacts") });
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
          {/* Agent Intelligence Card */}
          <div className="mb-6">
            <h2 className="text-[11px] font-semibold text-text-blue uppercase tracking-wide mb-3">
              <span className="mr-1">&#9671;</span> What I Know About {contact.firstName}
            </h2>
            <div className="bg-bg-secondary border-l-2 border-accent rounded-lg px-4 py-3">
              {agentInsights ? (
                <>
                  <p className="text-sm text-text-primary mb-2">{agentInsights.summary}</p>
                  {agentInsights.traits.length > 0 && (
                    <ul className="space-y-1">
                      {agentInsights.traits.map((trait, i) => (
                        <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="text-text-tertiary mt-0.5">&#8226;</span>
                          {trait}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-tertiary italic">
                  Intelligence will appear after agent processing
                </p>
              )}
            </div>
          </div>

          {/* Conversation History */}
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Conversation History</h2>
          <ActivityTimeline activities={activities} />
        </div>

        {/* ── Right column ── */}
        <div className="space-y-6">
          {/* Details */}
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Details</h2>
            <div className="rounded-lg border border-border p-4">
              <PropertyRow label="Email">
                {contact.email ? <a href={`mailto:${contact.email}`} className="text-accent hover:underline">{contact.email}</a> : "\u2014"}
              </PropertyRow>
              <PropertyRow label="Phone">{contact.phone || "\u2014"}</PropertyRow>
              <PropertyRow label="Title">{contact.title || "\u2014"}</PropertyRow>
              <PropertyRow label="Company">
                {company ? <Link to={`/companies/${company.id}`} className="text-accent hover:underline">{company.name}</Link> : "\u2014"}
              </PropertyRow>
              <PropertyRow label="LinkedIn">
                {contact.linkedIn ? <a href={contact.linkedIn} target="_blank" rel="noreferrer" className="text-accent hover:underline">{contact.linkedIn}</a> : "\u2014"}
              </PropertyRow>
              <PropertyRow label="Source">
                {contact.source ? <Badge color="gray">{contact.source}</Badge> : "\u2014"}
              </PropertyRow>
              <PropertyRow label="Created">
                {new Date(contact.createdAt).toLocaleDateString()}
              </PropertyRow>
            </div>
          </div>

          {/* Connected To */}
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Connected To</h2>
            <div className="rounded-lg border border-border p-4 space-y-3">
              {/* Deals */}
              <div>
                <span className="text-[12px] font-medium text-text-secondary block mb-1">Deals</span>
                {contactDeals.length > 0 ? (
                  <ul className="space-y-1">
                    {contactDeals.map((deal) => (
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

              {/* Company */}
              {company && (
                <div>
                  <span className="text-[12px] font-medium text-text-secondary block mb-1">Company</span>
                  <Link to={`/companies/${company.id}`} className="text-sm text-accent hover:underline">{company.name}</Link>
                </div>
              )}

              {/* Other contacts at company */}
              {siblingContacts.length > 0 && (
                <div>
                  <span className="text-[12px] font-medium text-text-secondary block mb-1">
                    Other contacts at {company?.name ?? "company"}
                  </span>
                  <ul className="space-y-1">
                    {siblingContacts.map((c) => (
                      <li key={c.id}>
                        <Link to={`/contacts/${c.id}`} className="text-sm text-accent hover:underline">
                          {c.firstName} {c.lastName}
                          {c.title && <span className="text-text-tertiary ml-1">({c.title})</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pending actions for this contact */}
              <EntityActions entityType="contact" entityId={contact.id} />

              {/* Tasks */}
              <div>
                <EntityTasks entityType="crm_contact" entityId={contact.id} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Full-width Dossier below two-column area ── */}
      {hasDossier ? (
        <ContactDossierView
          data={dossier!}
          entityName={`${contact.firstName} ${contact.lastName}`}
        />
      ) : enrichment && Object.keys(enrichment.fields).length > 0 ? (
        /* Legacy enrichment fallback — rendered inline, not in sidebar */
        <div className="mt-8 border border-border rounded-lg p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Enrichment</h2>
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
        </div>
      ) : (
        <div className="mt-8 border border-dashed border-border rounded-lg p-8 text-center">
          <p className="text-sm text-text-tertiary italic">
            Hebbs is researching {contact.firstName} {contact.lastName}...
          </p>
          <p className="text-[11px] text-text-tertiary mt-1">
            The dossier will appear here once enrichment completes.
          </p>
        </div>
      )}

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Contact">
        <ContactForm
          initial={contact}
          onSubmit={(data) => {
            updateContact.mutate({ ...data, id: contact.id }, { onSuccess: () => setShowEdit(false) });
          }}
          onCancel={() => setShowEdit(false)}
          loading={updateContact.isPending}
        />
      </Modal>
    </div>
  );
}
