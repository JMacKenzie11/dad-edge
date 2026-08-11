import { cn } from "@/lib/cn";
import type { PillarCode } from "@/lib/pillars";
import { PILLAR_BY_CODE } from "@/lib/pillars";

type Status = "planned" | "completed" | "missed" | "rolled_over";

export function MissionCard({
  description,
  pillar,
  targetDate,
  status,
  late,
  className,
}: {
  description: string;
  pillar: PillarCode;
  targetDate: string;
  status: Status;
  late?: boolean;
  className?: string;
}) {
  const p = PILLAR_BY_CODE[pillar];
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]",
        className,
      )}
    >
      <span
        className="mt-1 inline-block h-8 w-1.5 rounded-full"
        style={{ background: p.colorVar }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            {p.label}
          </span>
          <StatusPill status={status} late={late} />
        </div>
        <p className="text-sm leading-snug">{description}</p>
        <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
          Target: {targetDate}
        </p>
      </div>
    </div>
  );
}

function StatusPill({ status, late }: { status: Status; late?: boolean }) {
  const map: Record<Status, { label: string; color: string }> = {
    planned: { label: "Planned", color: "var(--color-primary)" },
    completed: { label: late ? "Completed · late" : "Completed", color: "var(--color-success)" },
    missed: { label: "Missed", color: "var(--color-danger)" },
    rolled_over: { label: "Rolled over", color: "var(--color-warning)" },
  };
  const s = map[status];
  return (
    <span
      className="inline-flex items-center h-5 px-2 rounded-[var(--radius-chip)] text-[10px] font-heading tracking-widest text-white"
      style={{ background: s.color }}
    >
      {s.label.toUpperCase()}
    </span>
  );
}
