import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  useCreateCopilotSession,
  useSendCopilotMessage,
} from "../hooks/useCopilot";

export function CommandBar() {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const createSession = useCreateCopilotSession();
  const sendMessage = useSendCopilotMessage();

  // Cmd+K focuses input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if (!text || sending) return;

    setSending(true);
    setValue("");

    try {
      const pageName = location.pathname.replace(/^\//, "") || "home";
      const result = await createSession.mutateAsync({
        title: text.slice(0, 60),
      });
      const sessionId = result.data.id;

      await sendMessage.mutateAsync({
        sessionId,
        message: `[From: ${pageName}] ${text}`,
      });

      navigate(`/copilot/${sessionId}`);
    } catch {
      // Restore value on error
      setValue(text);
    } finally {
      setSending(false);
    }
  }, [value, sending, location.pathname, createSession, sendMessage, navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        inputRef.current?.blur();
      }
    },
    [handleSend],
  );

  return (
    <div className="shrink-0 border-t border-border bg-bg">
      <div className="w-full px-6 py-3">
        <div className="max-w-[720px] mx-auto bg-bg border border-border-dark flex items-center px-4 py-2.5 gap-2 rounded-xl focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 transition-all">
          <span className="text-[13px] font-semibold text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded shrink-0">
            &#8984;K
          </span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything, do anything..."
            disabled={sending}
            className="flex-1 border-none outline-none text-sm font-sans text-text-primary bg-transparent placeholder:text-text-tertiary disabled:opacity-50"
          />
          {sending && (
            <span className="text-xs text-text-tertiary shrink-0">Sending...</span>
          )}
          {!sending && value.trim() && (
            <button
              onClick={handleSend}
              className="text-xs text-text-tertiary hover:text-text-primary shrink-0 px-1.5 py-0.5 rounded hover:bg-bg-secondary transition-colors"
            >
              &#8629;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
