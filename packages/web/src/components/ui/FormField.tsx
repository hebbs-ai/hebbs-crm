import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const labelClass = "mb-1 block text-xs font-medium uppercase tracking-wide text-text-tertiary";
const inputClass = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";

interface FieldProps {
  label: string;
  className?: string;
}

export function Input({ label, className = "", ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      <input className={inputClass} {...props} />
    </div>
  );
}

export function Textarea({ label, className = "", ...props }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      <textarea className={`${inputClass} min-h-[80px] resize-y`} {...props} />
    </div>
  );
}

interface SelectFieldProps extends FieldProps, SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function Select({ label, options, placeholder, className = "", ...props }: SelectFieldProps) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      <select className={inputClass} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
