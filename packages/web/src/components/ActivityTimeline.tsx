import type { Activity } from "@boringos-crm/shared";

const typeConfig: Record<string, { icon: string; bg: string }> = {
  call: { icon: "\uD83D\uDCDE", bg: "bg-surface-green" },
  email: { icon: "\u2709", bg: "bg-surface-blue" },
  meeting: { icon: "\uD83D\uDCC5", bg: "bg-surface-purple" },
  note: { icon: "\uD83D\uDCDD", bg: "bg-surface-yellow" },
  task: { icon: "\u2611", bg: "bg-surface-orange" },
};

interface ActivityTimelineProps {
  activities: Activity[];
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return <p className="text-sm text-text-tertiary py-4">No activities yet</p>;
  }

  return (
    <div>
      {activities.map((a) => {
        const config = typeConfig[a.type] ?? { icon: "\u2022", bg: "bg-bg-secondary" };
        const date = new Date(a.occurredAt ?? a.createdAt);
        return (
          <div key={a.id} className="flex gap-3 py-3 border-b border-border">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] shrink-0 ${config.bg}`}>
              {config.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-text-primary">{a.subject}</span>
                <span className="text-xs text-text-tertiary shrink-0 ml-2">
                  {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {a.body && (
                <p className="mt-1 text-[13px] text-text-secondary line-clamp-2">{a.body}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
