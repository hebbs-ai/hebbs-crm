import { useState, useRef, useEffect, useCallback } from "react";
import {
  useCopilotSession,
  useCreateCopilotSession,
  useSendCopilotMessage,
} from "../hooks/useCopilot";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export function CommandBar() {
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [waitingForReply, setWaitingForReply] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: sessionData } = useCopilotSession(sessionId);
  const createSession = useCreateCopilotSession();
  const sendMessage = useSendCopilotMessage();

  const serverMessages: Message[] = sessionData?.data?.messages ?? [];

  // Merge server messages with optimistic ones — server is source of truth
  const messages: Message[] = (() => {
    if (serverMessages.length === 0) return optimisticMessages;

    // Check if server has caught up with our optimistic user messages
    const serverIds = new Set(serverMessages.map((m) => m.id));
    const pending = optimisticMessages.filter(
      (m) => !serverIds.has(m.id) && m.id.startsWith("optimistic-"),
    );
    return [...serverMessages, ...pending];
  })();

  // Clear waiting state when assistant responds
  useEffect(() => {
    if (serverMessages.length > 0) {
      const last = serverMessages[serverMessages.length - 1];
      if (last.role === "assistant") {
        setWaitingForReply(false);
        // Clear optimistic messages once server has assistant reply
        setOptimisticMessages([]);
      }
    }
  }, [serverMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, waitingForReply]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setExpanded(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleClose = useCallback(() => {
    setExpanded(false);
    inputRef.current?.blur();
  }, []);

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if (!text) return;

    setValue("");
    setExpanded(true);
    setWaitingForReply(true);

    // Add optimistic user message
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages((prev) => [...prev, optimisticMsg]);

    try {
      let activeSessionId = sessionId;

      // Create session if needed
      if (!activeSessionId) {
        const result = await createSession.mutateAsync({
          title: text.slice(0, 60),
        });
        activeSessionId = result.data.id;
        setSessionId(activeSessionId);
      }

      // Send message
      await sendMessage.mutateAsync({
        sessionId: activeSessionId,
        message: text,
      });
    } catch {
      setWaitingForReply(false);
    }
  }, [value, sessionId, createSession, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        handleClose();
      }
    },
    [handleSend, handleClose],
  );

  const hasContent = expanded && messages.length > 0;

  return (
    <div className="fixed bottom-0 left-[248px] right-0 z-50 flex flex-col items-center pointer-events-none">
      {/* Expanded chat panel */}
      {hasContent && (
        <div className="w-full max-w-[720px] mx-auto pointer-events-auto">
          <div className="bg-bg border border-border-dark border-b-0 rounded-t-xl shadow-md max-h-[60vh] flex flex-col">
            {/* Header with close button */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span className="text-xs font-medium text-text-secondary">
                Copilot
              </span>
              <button
                onClick={handleClose}
                className="text-text-tertiary hover:text-text-primary text-sm leading-none p-1 rounded hover:bg-bg-secondary transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-3">
                  {msg.role === "assistant" ? (
                    <div className="w-7 h-7 rounded-full bg-surface-blue text-text-blue flex items-center justify-center text-xs font-semibold shrink-0">
                      &#9671;
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-surface-purple text-text-purple flex items-center justify-center text-xs font-semibold shrink-0">
                      U
                    </div>
                  )}
                  <div className="flex-1 text-sm text-text-primary leading-relaxed pt-0.5 whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Thinking indicator */}
              {waitingForReply && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-surface-blue text-text-blue flex items-center justify-center text-xs font-semibold shrink-0">
                    &#9671;
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse [animation-delay:300ms]" />
                    <span className="text-xs text-text-tertiary ml-1.5">
                      Thinking...
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="w-full px-6 pb-4 pt-3 bg-gradient-to-t from-bg to-transparent pointer-events-auto">
        <div
          className={`max-w-[720px] mx-auto bg-bg border border-border-dark shadow-md flex items-center px-4 py-2.5 gap-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 transition-all ${
            hasContent ? "rounded-b-xl rounded-t-none border-t-0" : "rounded-xl"
          }`}
        >
          <span className="text-[13px] font-semibold text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded shrink-0">
            &#8984;K
          </span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setExpanded(true)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything, do anything..."
            className="flex-1 border-none outline-none text-sm font-sans text-text-primary bg-transparent placeholder:text-text-tertiary"
          />
          {value.trim() && (
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
