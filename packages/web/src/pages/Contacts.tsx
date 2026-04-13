import { useState } from "react";
import { Link } from "react-router-dom";
import { useContacts, useCreateContact, useDeleteContact } from "../hooks/useContacts";
import { Modal } from "../components/ui/Modal";
import { ContactForm } from "../components/ContactForm";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchInput } from "../components/ui/SearchInput";
import { EmptyState } from "../components/ui/EmptyState";
import type { Contact } from "@boringos-crm/shared";

export function ContactsPage() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useContacts({ search: search || undefined });
  const createContact = useCreateContact();
  const deleteContact = useDeleteContact();

  const contacts = data?.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            + New Contact
          </button>
        }
      />

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search contacts..." />
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary py-8 text-center">Loading...</p>
      ) : contacts.length === 0 ? (
        <EmptyState
          title="No contacts yet"
          description={search ? "Try a different search term" : "Add your first contact to get started"}
          action={!search ? { label: "New Contact", onClick: () => setShowCreate(true) } : undefined}
        />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Name</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Email</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Title</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Source</th>
              <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border w-20"></th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c: Contact) => (
              <tr key={c.id} className="hover:bg-bg-secondary transition-colors">
                <td className="px-3 py-2.5 border-b border-border">
                  <Link to={`/contacts/${c.id}`} className="font-medium text-text-primary hover:text-accent">
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">{c.email || "\u2014"}</td>
                <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">{c.title || "\u2014"}</td>
                <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">{c.source || "\u2014"}</td>
                <td className="px-3 py-2.5 border-b border-border text-right">
                  <button
                    onClick={() => { if (confirm("Delete this contact?")) deleteContact.mutate(c.id); }}
                    className="text-xs text-text-tertiary hover:text-text-red transition-colors"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Contact">
        <ContactForm
          onSubmit={(data) => {
            createContact.mutate(data, { onSuccess: () => setShowCreate(false) });
          }}
          onCancel={() => setShowCreate(false)}
          loading={createContact.isPending}
        />
      </Modal>
    </div>
  );
}
