import { useState, useRef, useEffect, useCallback } from "react";
import { useInboxThread, useReplyToEmail, type ThreadMessage } from "../hooks/useInbox";
import { Badge } from "./ui/Badge";

interface AgentAnalysis {
  score: number;
  classification: string;
  summary: string;
  contactMatch?: { id?: string; email: string; name: string };
  dealContext?: string;
  suggestedAction?: string;
  draftResponse?: string;
  processedAt: string;
}

interface InboxItem {
  id: string;
  source: string;
  subject: string;
  body: string | null;
  from: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface EmailViewerModalProps {
  item: InboxItem;
  onClose: () => void;
  mode: "attention" | "handled";
  onArchiveGmail?: () => void;
}

export function EmailViewerModal({ item, onClose, mode, onArchiveGmail }: EmailViewerModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useInboxThread(item.source === "gmail" ? item.id : null);
  const [draftText, setDraftText] = useState("");
  const [sent, setSent] = useState(false);
  const reply = useReplyToEmail();
  const analysis = (item.metadata?.agentAnalysis as AgentAnalysis) ?? null;

  // Pre-fill draft from agent analysis
  useEffect(() => {
    if (analysis?.draftResponse && mode === "attention") {
      setDraftText(analysis.draftResponse);
    }
  }, [analysis?.draftResponse, mode]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Get thread messages from API response or from cached metadata
  const threadMessages: ThreadMessage[] =
    data?.threadMessages ??
    (item.metadata?.threadMessages as ThreadMessage[] | undefined) ??
    [];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full h-full max-w-[1200px] max-h-[90vh] mx-4 my-[5vh] rounded-lg border border-border bg-bg shadow-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-4 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-text-primary truncate">
              {item.subject || "No subject"}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-text-secondary">{item.from || "Unknown sender"}</span>
              {analysis && (
                <>
                  <Badge color={classColors[analysis.classification] ?? "gray"}>{analysis.classification}</Badge>
                  <Badge color={scoreColor(analysis.score)}>{analysis.score}</Badge>
                </>
              )}
              {threadMessages.length > 1 && (
                <span className="text-xs text-text-tertiary">{threadMessages.length} messages in thread</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {item.source === "gmail" && onArchiveGmail && (
              <button
                onClick={onArchiveGmail}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors"
              >
                Archive in Gmail
              </button>
            )}
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary transition-colors text-xl leading-none px-2"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Thread */}
          <div className="flex-1 overflow-y-auto p-6 min-w-0">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-3 bg-bg-active rounded w-1/3 mb-2" />
                    <div className="h-20 bg-bg-secondary rounded" />
                  </div>
                ))}
              </div>
            ) : threadMessages.length > 0 ? (
              <div className="space-y-4">
                {threadMessages.map((msg, i) => (
                  <ThreadMessageCard
                    key={msg.id}
                    message={msg}
                    defaultExpanded={i === threadMessages.length - 1}
                  />
                ))}
              </div>
            ) : (
              // Fallback: show single email body
              <SingleEmailBody item={item} />
            )}

            {/* Draft reply — below thread, only for attention items */}
            {mode === "attention" && (
              <div className="mt-6 border-t border-border pt-4">
                <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  Reply
                </div>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Write a reply..."
                  className="w-full min-h-[120px] p-3 text-sm border border-border rounded-md bg-bg text-text-primary resize-y focus:border-accent focus:ring-2 focus:ring-accent/15 outline-none"
                />
                <div className="flex items-center gap-2 mt-2">
                  {sent ? (
                    <span className="text-xs text-text-green font-medium">Sent!</span>
                  ) : (
                    <button
                      onClick={() => {
                        if (!draftText.trim()) return;
                        reply.mutate({ id: item.id, body: draftText }, {
                          onSuccess: () => setSent(true),
                        });
                      }}
                      disabled={reply.isPending || !draftText.trim()}
                      className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
                    >
                      {reply.isPending ? "Sending..." : "Send"}
                    </button>
                  )}
                  {analysis?.draftResponse && draftText !== analysis.draftResponse && !sent && (
                    <button
                      onClick={() => setDraftText(analysis.draftResponse!)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      Reset to AI draft
                    </button>
                  )}
                  {reply.isError && (
                    <span className="text-xs text-text-red">{reply.error.message}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Sidebar — agent analysis */}
          {analysis && (
            <div className="w-[300px] border-l border-border overflow-y-auto p-5 shrink-0 bg-bg-secondary">
              <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-3">
                Agent Analysis
              </div>

              <div className="space-y-4">
                <div>
                  <div className="text-xs text-text-tertiary mb-1">Summary</div>
                  <p className="text-sm text-text-primary">{analysis.summary}</p>
                </div>

                {analysis.contactMatch && (
                  <div>
                    <div className="text-xs text-text-tertiary mb-1">Contact</div>
                    <p className="text-sm text-accent">{analysis.contactMatch.name}</p>
                    <p className="text-xs text-text-secondary">{analysis.contactMatch.email}</p>
                  </div>
                )}

                {analysis.dealContext && (
                  <div>
                    <div className="text-xs text-text-tertiary mb-1">Deal</div>
                    <p className="text-sm text-text-primary">{analysis.dealContext}</p>
                  </div>
                )}

                {analysis.suggestedAction && (
                  <div>
                    <div className="text-xs text-text-tertiary mb-1">Suggested Action</div>
                    <p className="text-sm text-text-blue">{analysis.suggestedAction}</p>
                  </div>
                )}

                <div>
                  <div className="text-xs text-text-tertiary mb-1">Importance</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-bg-active rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${analysis.score}%`,
                          backgroundColor: analysis.score >= 70 ? "#2e68d2" : analysis.score >= 50 ? "#d29e2e" : "#b4b4b0",
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-text-primary">{analysis.score}</span>
                  </div>
                </div>

                {analysis.processedAt && (
                  <div className="text-xs text-text-tertiary">
                    Analyzed {formatDate(analysis.processedAt)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Single thread message, expandable */
function ThreadMessageCard({
  message,
  defaultExpanded,
}: {
  message: ThreadMessage;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const fromName = message.from
    ? message.from.replace(/<[^>]+>/, "").trim() || message.from
    : "Unknown";

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-center gap-2 hover:bg-bg-hover transition-colors"
      >
        <span className="text-xs text-text-tertiary">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className="text-sm font-medium text-text-primary truncate">{fromName}</span>
        {message.date && (
          <span className="ml-auto text-xs text-text-tertiary shrink-0">{formatDate(message.date)}</span>
        )}
      </button>

      {/* Expanded: show snippet or full body */}
      {!expanded && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-xs text-text-secondary truncate">{message.snippet}</p>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border">
          {/* To line */}
          {message.to && (
            <div className="px-4 pt-2 text-xs text-text-tertiary">
              To: {message.to}
            </div>
          )}
          {/* Email body */}
          <div className="p-4">
            {message.bodyHtml ? (
              <SandboxedHtml html={message.bodyHtml} />
            ) : (
              <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans">
                {message.bodyPlain || message.snippet || "No content"}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders HTML email content in a sandboxed iframe */
function SandboxedHtml({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const adjustHeight = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return;
    const h = iframe.contentDocument.body.scrollHeight;
    if (h > 0) setHeight(Math.min(h + 20, 800));
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      adjustHeight();
      // Observe size changes (images loading, etc.)
      const observer = new ResizeObserver(adjustHeight);
      if (iframe.contentDocument?.body) {
        observer.observe(iframe.contentDocument.body);
      }
      return () => observer.disconnect();
    };

    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [adjustHeight]);

  // Wrap HTML with base styles for consistent rendering
  const wrappedHtml = `<!DOCTYPE html>
<html><head><style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.6; color: #37352f; margin: 0; padding: 0; }
  img { max-width: 100%; height: auto; }
  a { color: #2e68d2; }
  blockquote { border-left: 2px solid #e9e9e7; margin: 8px 0; padding-left: 12px; color: #787774; }
</style></head><body>${html}</body></html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={wrappedHtml}
      sandbox="allow-same-origin"
      style={{ width: "100%", height, border: "none" }}
      title="Email content"
    />
  );
}

/** Fallback for items without thread data */
function SingleEmailBody({ item }: { item: InboxItem }) {
  const bodyHtml = (item.metadata?.bodyHtml as string) ?? null;
  const bodyPlain = item.body;

  if (bodyHtml) {
    return <SandboxedHtml html={bodyHtml} />;
  }

  return (
    <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans">
      {bodyPlain || "No email content available"}
    </pre>
  );
}

// Helpers

const classColors: Record<string, "green" | "blue" | "gray" | "yellow" | "orange" | "red"> = {
  lead: "green",
  reply: "blue",
  internal: "gray",
  newsletter: "yellow",
  spam: "red",
};

function scoreColor(score: number): "green" | "blue" | "yellow" | "gray" {
  if (score >= 90) return "green";
  if (score >= 70) return "blue";
  if (score >= 50) return "yellow";
  return "gray";
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    if (diffDays < 7) {
      return d.toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}
