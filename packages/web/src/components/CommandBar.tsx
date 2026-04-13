import { useState } from "react";

export function CommandBar() {
  const [value, setValue] = useState("");

  return (
    <div className="fixed bottom-0 left-[248px] right-0 px-6 pb-4 pt-3 bg-gradient-to-t from-bg to-transparent z-50">
      <div className="max-w-[720px] mx-auto bg-bg border border-border-dark rounded-xl shadow-md flex items-center px-4 py-2.5 gap-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 transition-all">
        <span className="text-[13px] font-semibold text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded shrink-0">
          \u2318K
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask anything, do anything..."
          className="flex-1 border-none outline-none text-sm font-sans text-text-primary bg-transparent placeholder:text-text-tertiary"
        />
      </div>
    </div>
  );
}
