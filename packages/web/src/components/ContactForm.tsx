import { useState, useEffect } from "react";
import { Input, Select } from "./ui/FormField";
import { useCompanies } from "../hooks/useCompanies";
import type { Contact } from "@boringos-crm/shared";

interface ContactFormProps {
  initial?: Partial<Contact>;
  onSubmit: (data: Partial<Contact>) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ContactForm({ initial, onSubmit, onCancel, loading }: ContactFormProps) {
  const [form, setForm] = useState({
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    title: initial?.title ?? "",
    companyId: initial?.companyId ?? "",
    linkedIn: initial?.linkedIn ?? "",
    source: initial?.source ?? "",
  });

  const { data: companiesData } = useCompanies();
  const companies = companiesData?.data ?? [];

  useEffect(() => {
    if (initial) {
      setForm({
        firstName: initial.firstName ?? "",
        lastName: initial.lastName ?? "",
        email: initial.email ?? "",
        phone: initial.phone ?? "",
        title: initial.title ?? "",
        companyId: initial.companyId ?? "",
        linkedIn: initial.linkedIn ?? "",
        source: initial.source ?? "",
      });
    }
  }, [initial]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      companyId: form.companyId || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Input label="First Name" value={form.firstName} onChange={(e) => set("firstName", (e.target as HTMLInputElement).value)} required />
        <Input label="Last Name" value={form.lastName} onChange={(e) => set("lastName", (e.target as HTMLInputElement).value)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Input label="Email" type="email" value={form.email} onChange={(e) => set("email", (e.target as HTMLInputElement).value)} />
        <Input label="Phone" value={form.phone} onChange={(e) => set("phone", (e.target as HTMLInputElement).value)} />
      </div>
      <Input label="Title" value={form.title} onChange={(e) => set("title", (e.target as HTMLInputElement).value)} className="mt-3" />
      <Select
        label="Company"
        value={form.companyId}
        onChange={(e) => set("companyId", (e.target as HTMLSelectElement).value)}
        placeholder="No company"
        options={companies.map((c) => ({ value: c.id, label: c.name }))}
        className="mt-3"
      />
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Input label="LinkedIn" value={form.linkedIn} onChange={(e) => set("linkedIn", (e.target as HTMLInputElement).value)} placeholder="linkedin.com/in/..." />
        <Input label="Source" value={form.source} onChange={(e) => set("source", (e.target as HTMLInputElement).value)} placeholder="Inbound, Outbound, etc." />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
          {loading ? "Saving..." : initial?.id ? "Update" : "Create"}
        </button>
      </div>
    </form>
  );
}
