import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useCopilotSessions,
  useCopilotSession,
  useCreateCopilotSession,
  useSendCopilotMessage,
} from "../hooks/useCopilot";
import type { CopilotMessage } from "../hooks/useCopilot";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function SessionList({
  activeId,
  onNewSession,
}: {
  activeId?: string;
  onNewSession: () => void;
}) {
  const { data, isLoading } = useCopilotSessions();
  const navigate = useNavigate();

  const sessions = [...(data?.data ?? [])].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return (
    <div className="w-[280px] shrink-0 border-r border-border flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-text-primary">Copilot</h2>
        <button
          onClick={onNewSession}
          className="text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover px-2 py-1 rounded-md transition-colors"
        >
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-xs text-text-tertiary text-center py-6">Loading...</p>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-6">No conversations yet</p>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/copilot/${s.id}`)}
              className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${
                s.id === activeId
                  ? "bg-bg-hover"
                  : "hover:bg-bg-hover"
              }`}
            >
              <div className="text-sm text-text-primary truncate">
                {s.title || "Untitled"}
              </div>
              <div className="text-xs text-text-tertiary mt-0.5">
                {timeAgo(s.updatedAt)}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: CopilotMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-full bg-surface-purple text-text-purple flex items-center justify-center text-xs font-semibold shrink-0">
          U
        </div>
        <div className="flex-1 text-sm text-text-primary leading-relaxed pt-0.5 whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-surface-blue text-text-blue flex items-center justify-center text-xs font-semibold shrink-0">
        &#9671;
      </div>
      <div className="flex-1 bg-bg-secondary border-l-2 border-text-blue rounded-lg px-4 py-3 text-sm text-text-primary leading-relaxed copilot-markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-surface-blue text-text-blue flex items-center justify-center text-xs font-semibold shrink-0">
        &#9671;
      </div>
      <div className="flex items-center gap-1 pt-1">
        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-pulse [animation-delay:300ms]" />
        <span className="text-xs text-text-tertiary ml-1.5">Thinking...</span>
      </div>
    </div>
  );
}

function Conversation({ sessionId }: { sessionId: string }) {
  const { data } = useCopilotSession(sessionId);
  const sendMessage = useSendCopilotMessage();
  const [value, setValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages: CopilotMessage[] = data?.data?.messages ?? [];
  const isWaiting =
    messages.length > 0 && messages[messages.length - 1].role === "user";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isWaiting]);

  // Focus textarea when session changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId]);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    sendMessage.mutate({ sessionId, message: text });
  }, [value, sessionId, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isWaiting && <ThinkingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-border px-6 py-3">
        <div className="flex items-end gap-2 bg-bg border border-border-dark rounded-xl px-4 py-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            className="flex-1 resize-none border-none outline-none text-sm font-sans text-text-primary bg-transparent placeholder:text-text-tertiary leading-relaxed max-h-32"
          />
          {value.trim() && (
            <button
              onClick={handleSend}
              className="text-xs text-text-tertiary hover:text-text-primary shrink-0 px-2 py-1 rounded hover:bg-bg-secondary transition-colors"
            >
              &#8629;
            </button>
          )}
        </div>
        <p className="text-[11px] text-text-tertiary text-center mt-1.5">
          <kbd className="px-1 py-0.5 rounded bg-bg-secondary font-mono">&#8984;K</kbd> from anywhere in the CRM
        </p>
      </div>
    </div>
  );
}

function EmptyConversation({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="text-4xl mb-3 text-text-tertiary">&#9671;</div>
        <p className="text-sm text-text-secondary">
          Start a conversation —{" "}
          <button
            onClick={onNewSession}
            className="text-accent hover:underline"
          >
            click New conversation
          </button>
        </p>
        <p className="text-xs text-text-tertiary mt-3 leading-relaxed">
          Tip: press{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-bg-secondary text-text-tertiary font-mono">
            &#8984;K
          </kbd>{" "}
          from <span className="font-medium">any page in the CRM</span> to ask the copilot without leaving — try it from a contact or deal page to ask "what do I know about this person?"
        </p>
      </div>
    </div>
  );
}

export function CopilotPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const createSession = useCreateCopilotSession();

  const handleNewSession = useCallback(async () => {
    const result = await createSession.mutateAsync({ title: "New conversation" });
    navigate(`/copilot/${result.data.id}`);
  }, [createSession, navigate]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <SessionList activeId={sessionId} onNewSession={handleNewSession} />
      {sessionId ? (
        <Conversation sessionId={sessionId} />
      ) : (
        <EmptyConversation onNewSession={handleNewSession} />
      )}
    </div>
  );
}
