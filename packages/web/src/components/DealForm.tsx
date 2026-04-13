import { useState, useEffect } from "react";
import { Input, Select } from "./ui/FormField";
import { usePipelines, usePipeline } from "../hooks/usePipelines";
import { useContacts } from "../hooks/useContacts";
import { useCompanies } from "../hooks/useCompanies";
import type { Deal } from "@boringos-crm/shared";

const CURRENCIES = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "CAD", label: "CAD" },
  { value: "AUD", label: "AUD" },
];

interface DealFormProps {
  initial?: Partial<Deal>;
  onSubmit: (data: Partial<Deal>) => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DealForm({ initial, onSubmit, onCancel, loading }: DealFormProps) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    value: initial?.value != null ? String(initial.value / 100) : "",
    currency: initial?.currency ?? "USD",
    pipelineId: initial?.pipelineId ?? "",
    stageId: initial?.stageId ?? "",
    contactId: initial?.contactId ?? "",
    companyId: initial?.companyId ?? "",
    expectedCloseDate: initial?.expectedCloseDate ? initial.expectedCloseDate.slice(0, 10) : "",
    probability: initial?.probability != null ? String(initial.probability) : "",
  });

  const { data: pipelinesData } = usePipelines();
  const pipelines = pipelinesData?.data ?? [];

  const selectedPipelineId = form.pipelineId || (pipelines.length > 0 ? pipelines[0].id : "");
  const { data: pipelineData } = usePipeline(selectedPipelineId);
  const stages = pipelineData?.data?.stages ?? [];

  const { data: contactsData } = useContacts();
  const contacts = contactsData?.data ?? [];

  const { data: companiesData } = useCompanies();
  const companies = companiesData?.data ?? [];

  // Auto-select first pipeline if none selected
  useEffect(() => {
    if (!form.pipelineId && pipelines.length > 0) {
      setForm((f) => ({ ...f, pipelineId: pipelines[0].id }));
    }
  }, [pipelines, form.pipelineId]);

  // Auto-select first stage when pipeline changes
  useEffect(() => {
    if (stages.length > 0 && !stages.find((s) => s.id === form.stageId)) {
      setForm((f) => ({ ...f, stageId: stages[0].id }));
    }
  }, [stages, form.stageId]);

  useEffect(() => {
    if (initial) {
      setForm({
        title: initial.title ?? "",
        value: initial.value != null ? String(initial.value / 100) : "",
        currency: initial.currency ?? "USD",
        pipelineId: initial.pipelineId ?? "",
        stageId: initial.stageId ?? "",
        contactId: initial.contactId ?? "",
        companyId: initial.companyId ?? "",
        expectedCloseDate: initial.expectedCloseDate ? initial.expectedCloseDate.slice(0, 10) : "",
        probability: initial.probability != null ? String(initial.probability) : "",
      });
    }
  }, [initial]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: form.title,
      value: Math.round(parseFloat(form.value || "0") * 100),
      currency: form.currency,
      pipelineId: form.pipelineId,
      stageId: form.stageId,
      contactId: form.contactId || null,
      companyId: form.companyId || null,
      expectedCloseDate: form.expectedCloseDate || null,
      probability: form.probability ? Number(form.probability) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <Input label="Title" value={form.title} onChange={(e) => set("title", (e.target as HTMLInputElement).value)} required />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Input label="Value ($)" type="number" step="0.01" min="0" value={form.value} onChange={(e) => set("value", (e.target as HTMLInputElement).value)} placeholder="0.00" />
        <Select
          label="Currency"
          value={form.currency}
          onChange={(e) => set("currency", (e.target as HTMLSelectElement).value)}
          options={CURRENCIES}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Select
          label="Pipeline"
          value={form.pipelineId}
          onChange={(e) => set("pipelineId", (e.target as HTMLSelectElement).value)}
          options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Select pipeline"
        />
        <Select
          label="Stage"
          value={form.stageId}
          onChange={(e) => set("stageId", (e.target as HTMLSelectElement).value)}
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Select stage"
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Select
          label="Contact"
          value={form.contactId}
          onChange={(e) => set("contactId", (e.target as HTMLSelectElement).value)}
          placeholder="No contact"
          options={contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))}
        />
        <Select
          label="Company"
          value={form.companyId}
          onChange={(e) => set("companyId", (e.target as HTMLSelectElement).value)}
          placeholder="No company"
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Input label="Expected Close Date" type="date" value={form.expectedCloseDate} onChange={(e) => set("expectedCloseDate", (e.target as HTMLInputElement).value)} />
        <Input label="Probability (%)" type="number" min="0" max="100" value={form.probability} onChange={(e) => set("probability", (e.target as HTMLInputElement).value)} placeholder="0-100" />
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
