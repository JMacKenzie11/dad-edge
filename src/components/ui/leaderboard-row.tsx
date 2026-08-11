import { cn } from "@/lib/cn";
import { StreakChip } from "./streak-chip";

export function LeaderboardRow({
  rank,
  name,
  dailyTotal,
  missionRate,
  composite,
  streakDays,
  delta,
  className,
}: {
  rank: number;
  name: string;
  dailyTotal: number;
  missionRate: number;
  composite: number;
  streakDays: number;
  delta?: number;
  className?: string;
}) {
  const medal = rank === 1 ? "var(--color-accent)" : rank === 2 ? "var(--color-primary)" : rank === 3 ? "var(--color-warning)" : "var(--color-border)";
  return (
    <div
      className={cn(
        "grid grid-cols-[36px_1fr_auto_auto_auto] items-center gap-3 py-3 px-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]",
        className,
      )}
    >
      <span
        className="h-8 w-8 rounded-full flex items-center justify-center font-heading text-sm text-black"
        style={{ background: medal }}
        aria-label={`Rank ${rank}`}
      >
        {rank}
      </span>
      <div className="min-w-0">
        <p className="font-heading text-sm truncate">{name}</p>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          Daily {dailyTotal}/56 · Missions {Math.round(missionRate * 100)}%
        </p>
      </div>
      <span className="text-2xl font-heading text-[color:var(--color-accent)]">
        {composite.toFixed(0)}
      </span>
      <StreakChip days={streakDays} />
      {typeof delta === "number" ? (
        <span
          className="text-xs font-heading"
          style={{
            color: delta > 0 ? "var(--color-success)" : delta < 0 ? "var(--color-danger)" : "var(--color-text-muted)",
          }}
        >
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta)}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}
