import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useContact, useUpdateContact, useDeleteContact } from "../hooks/useContacts";
import { useActivities } from "../hooks/useActivities";
import { useCompany } from "../hooks/useCompanies";
import { Modal } from "../components/ui/Modal";
import { ContactForm } from "../components/ContactForm";
import { PropertyRow } from "../components/ui/PropertyRow";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Badge } from "../components/ui/Badge";
import { EntityTasks } from "../components/EntityTasks";

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useContact(id!);
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const { data: activitiesData } = useActivities({ contactId: id });
  const [showEdit, setShowEdit] = useState(false);

  const contact = data?.data;
  const { data: companyData } = useCompany(contact?.companyId ?? "");
  const company = companyData?.data;
  const activities = activitiesData?.data ?? [];

  if (isLoading) return <div className="p-8 text-sm text-text-secondary">Loading...</div>;
  if (!contact) return <div className="p-8 text-sm text-text-secondary">Contact not found</div>;

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <div className="mb-2">
        <Link to="/contacts" className="text-sm text-text-secondary hover:text-text-primary">{"\u2190"} Contacts</Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight leading-tight">
            {contact.firstName} {contact.lastName}
          </h1>
          {contact.title && company && (
            <p className="mt-1 text-sm text-text-secondary">
              {contact.title} at{" "}
              <Link to={`/companies/${company.id}`} className="text-accent hover:underline">{company.name}</Link>
            </p>
          )}
          {contact.title && !company && (
            <p className="mt-1 text-sm text-text-secondary">{contact.title}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
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

      <div className="grid grid-cols-[1fr_340px] gap-8">
        {/* Left: Timeline */}
        <div>
          {/* Tasks */}
          <div className="mb-6">
            <EntityTasks entityType="crm_contact" entityId={contact.id} />
          </div>

          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">Activity Timeline</h2>
          <ActivityTimeline activities={activities} />
        </div>

        {/* Right: Details */}
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
      </div>

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
