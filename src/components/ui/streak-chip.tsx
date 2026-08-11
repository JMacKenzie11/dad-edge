import { cn } from "@/lib/cn";

export function StreakChip({
  days,
  label,
  className,
}: {
  days: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-3 rounded-[var(--radius-chip)] text-xs font-heading",
        "bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] text-[color:var(--color-accent)]",
        className,
      )}
    >
      <span aria-hidden>▲</span>
      <span>{days}</span>
      {label ? <span className="text-[color:var(--color-text-muted)] normal-case tracking-normal">{label}</span> : null}
    </span>
  );
}
