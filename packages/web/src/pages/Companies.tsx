import { useState } from "react";
import { Link } from "react-router-dom";
import { useCompanies, useCreateCompany, useDeleteCompany } from "../hooks/useCompanies";
import { Modal } from "../components/ui/Modal";
import { CompanyForm } from "../components/CompanyForm";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchInput } from "../components/ui/SearchInput";
import { EmptyState } from "../components/ui/EmptyState";
import type { Company } from "@boringos-crm/shared";

export function CompaniesPage() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useCompanies({ search: search || undefined });
  const createCompany = useCreateCompany();
  const deleteCompany = useDeleteCompany();

  const companies = data?.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-8 pb-24 max-w-[1100px]">
      <PageHeader
        title="Companies"
        subtitle={`${companies.length} compan${companies.length !== 1 ? "ies" : "y"}`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            + New Company
          </button>
        }
      />

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search companies..." />
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary py-8 text-center">Loading...</p>
      ) : companies.length === 0 ? (
        <EmptyState
          title="No companies yet"
          description={search ? "Try a different search term" : "Add your first company to get started"}
          action={!search ? { label: "New Company", onClick: () => setShowCreate(true) } : undefined}
        />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Name</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Domain</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Industry</th>
              <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border">Size</th>
              <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-3 py-2 border-b border-border w-20"></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c: Company) => (
              <tr key={c.id} className="hover:bg-bg-secondary transition-colors">
                <td className="px-3 py-2.5 border-b border-border">
                  <Link to={`/companies/${c.id}`} className="font-medium text-text-primary hover:text-accent">
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">{c.domain || "\u2014"}</td>
                <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">{c.industry || "\u2014"}</td>
                <td className="px-3 py-2.5 border-b border-border text-text-secondary text-sm">{c.size || "\u2014"}</td>
                <td className="px-3 py-2.5 border-b border-border text-right">
                  <button
                    onClick={() => { if (confirm("Delete this company?")) deleteCompany.mutate(c.id); }}
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Company">
        <CompanyForm
          onSubmit={(data) => {
            createCompany.mutate(data, { onSuccess: () => setShowCreate(false) });
          }}
          onCancel={() => setShowCreate(false)}
          loading={createCompany.isPending}
        />
      </Modal>
    </div>
  );
}
