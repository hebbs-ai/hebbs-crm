import type { ReactNode } from "react";

interface PropertyRowProps {
  label: string;
  children: ReactNode;
}

export function PropertyRow({ label, children }: PropertyRowProps) {
  return (
    <div className="flex items-baseline py-1 text-sm">
      <span className="w-[140px] shrink-0 text-[13px] text-text-secondary">{label}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}
