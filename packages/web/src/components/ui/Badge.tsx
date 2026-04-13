type BadgeColor = "blue" | "green" | "yellow" | "red" | "purple" | "orange" | "gray";

const colorMap: Record<BadgeColor, string> = {
  blue: "bg-surface-blue text-text-blue",
  green: "bg-surface-green text-text-green",
  yellow: "bg-surface-yellow text-text-yellow",
  red: "bg-surface-red text-text-red",
  purple: "bg-surface-purple text-text-purple",
  orange: "bg-surface-orange text-text-orange",
  gray: "bg-bg-hover text-text-secondary",
};

interface BadgeProps {
  color: BadgeColor;
  children: React.ReactNode;
}

export function Badge({ color, children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${colorMap[color]}`}>
      {children}
    </span>
  );
}
