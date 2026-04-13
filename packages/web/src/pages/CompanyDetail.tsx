import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useCompany, useUpdateCompany, useDeleteCompany } from "../hooks/useCompanies";
import { useContacts } from "../hooks/useContacts";
import { useActivities } from "../hooks/useActivities";
import { Modal } from "../components/ui/Modal";
import { CompanyForm } from "../components/CompanyForm";
import { PropertyRow } from "../components/ui/PropertyRow";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Badge } from "../components/ui/Badge";
import { EntityTasks } from "../components/EntityTasks";
import type { Contact } from "@boringos-crm/shared";

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

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;
  if (!company) return <div className="p-8 text-sm text-text-secondary">Company not found</div>;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <div className="mb-2">
        <Link to="/companies" className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Companies</Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight leading-tight">
            {company.name}
          </h1>
          {company.industry && (
            <p className="mt-1 text-sm text-text-secondary">{company.industry}</p>
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

      <div className="grid grid-cols-[1fr_340px] gap-8">
        {/* Left: Contacts + Activity Timeline */}
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Contacts</h2>
          {contacts.length === 0 ? (
            <p className="text-sm text-text-tertiary py-4">No contacts at this company</p>
          ) : (
            <div className="rounded-lg border border-border mb-8">
              {contacts.map((c: Contact, i: number) => (
                <Link
                  key={c.id}
                  to={`/contacts/${c.id}`}
                  className={`flex items-center justify-between px-4 py-2.5 hover:bg-bg-secondary transition-colors ${i < contacts.length - 1 ? "border-b border-border" : ""}`}
                >
                  <div>
                    <span className="text-sm font-medium text-text-primary">{c.firstName} {c.lastName}</span>
                    {c.title && <span className="ml-2 text-[13px] text-text-tertiary">{c.title}</span>}
                  </div>
                  {c.email && <span className="text-[13px] text-text-secondary">{c.email}</span>}
                </Link>
              ))}
            </div>
          )}

          {/* Tasks */}
          <div className="mt-6 mb-6">
            <EntityTasks entityType="crm_company" entityId={company.id} />
          </div>

          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3 mt-6">Activity Timeline</h2>
          <ActivityTimeline activities={activities} />
        </div>

        {/* Right: Details */}
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
