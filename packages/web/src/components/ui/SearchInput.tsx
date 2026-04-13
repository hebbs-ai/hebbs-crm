import { useState, useEffect } from "react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search..." }: SearchInputProps) {
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => { if (local !== value) onChange(local); }, 300);
    return () => clearTimeout(timer);
  }, [local, value, onChange]);

  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 w-64"
    />
  );
}
