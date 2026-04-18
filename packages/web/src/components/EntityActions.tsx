import { useActions } from "../hooks/useActions";
import { ActionCard } from "./ActionCard";

interface EntityActionsProps {
  entityType: "contact" | "deal" | "company";
  entityId: string;
}

/**
 * Pending actions scoped to one entity, surfaced on the entity's detail page
 * so users see "what should I do about this contact/deal/company?" at a
 * glance instead of having to bounce to the Actions tab.
 */
export function EntityActions({ entityType, entityId }: EntityActionsProps) {
  const { data, isLoading } = useActions({ status: "todo", entityType, entityId });
  const items = data?.data ?? [];

  if (isLoading) return null;
  if (items.length === 0) return null;

  return (
    <section className="mt-6">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text-primary">Pending Actions</h3>
        <span className="text-xs text-text-tertiary">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </header>
      <div className="space-y-2">
        {items.map((a) => <ActionCard key={a.id} action={a} />)}
      </div>
    </section>
  );
}
