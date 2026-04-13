import { useState, useEffect } from "react";
import { Input, Select } from "./ui/FormField";
import type { Company } from "@boringos-crm/shared";

interface CompanyFormProps {
  initial?: Partial<Company>;
  onSubmit: (data: Partial<Company>) => void;
  onCancel: () => void;
  loading?: boolean;
}

const sizeOptions = [
  { value: "1-10", label: "1-10" },
  { value: "11-50", label: "11-50" },
  { value: "51-200", label: "51-200" },
  { value: "201-1000", label: "201-1,000" },
  { value: "1001-5000", label: "1,001-5,000" },
  { value: "5001+", label: "5,001+" },
];

export function CompanyForm({ initial, onSubmit, onCancel, loading }: CompanyFormProps) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    domain: initial?.domain ?? "",
    industry: initial?.industry ?? "",
    size: initial?.size ?? "",
    website: initial?.website ?? "",
    address: initial?.address ?? "",
  });

  useEffect(() => {
    if (initial) setForm({
      name: initial.name ?? "",
      domain: initial.domain ?? "",
      industry: initial.industry ?? "",
      size: initial.size ?? "",
      website: initial.website ?? "",
      address: initial.address ?? "",
    });
  }, [initial]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
      <Input label="Company Name" value={form.name} onChange={(e) => set("name", (e.target as HTMLInputElement).value)} required />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Input label="Domain" value={form.domain} onChange={(e) => set("domain", (e.target as HTMLInputElement).value)} placeholder="acme.com" />
        <Input label="Industry" value={form.industry} onChange={(e) => set("industry", (e.target as HTMLInputElement).value)} placeholder="SaaS, Fintech, etc." />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Select label="Size" value={form.size} onChange={(e) => set("size", (e.target as HTMLSelectElement).value)} options={sizeOptions} placeholder="Select size" />
        <Input label="Website" value={form.website} onChange={(e) => set("website", (e.target as HTMLInputElement).value)} placeholder="https://..." />
      </div>
      <Input label="Address" value={form.address} onChange={(e) => set("address", (e.target as HTMLInputElement).value)} className="mt-3" />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors">Cancel</button>
        <button type="submit" disabled={loading} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
          {loading ? "Saving..." : initial?.id ? "Update" : "Create"}
        </button>
      </div>
    </form>
  );
}
