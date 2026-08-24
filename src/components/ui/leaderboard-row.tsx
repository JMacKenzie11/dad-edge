import { cn } from "@/lib/cn";
import { StreakChip } from "./streak-chip";

/**
 * Leaderboard row. Displays three numbers per member:
 *   - Daily: X/49  (7 checkable pillars × 7 days)
 *   - Missions: Y/Z  (completed / planned)
 *   - Total: (X+Y)/(49+Z)  (combined weekly score)
 *
 * No composite score. Ranking upstream is by combined_total with
 * daily as tiebreaker; this component just displays.
 */
export function LeaderboardRow({
  rank,
  name,
  dailyTotal,
  dailyMax,
  missionCompleted,
  missionPlanned,
  combinedTotal,
  combinedMax,
  streakDays,
  delta,
  className,
}: {
  rank: number;
  name: string;
  dailyTotal: number;
  dailyMax: number;
  missionCompleted: number;
  missionPlanned: number;
  combinedTotal: number;
  combinedMax: number;
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
          Daily {dailyTotal}/{dailyMax} · Missions {missionCompleted}/{missionPlanned || "—"}
        </p>
      </div>
      <span className="text-2xl font-heading text-[color:var(--color-accent)]">
        {combinedTotal}
        <span className="text-xs text-[color:var(--color-text-muted)]">/{combinedMax}</span>
      </span>
      <StreakChip days={streakDays} />
      {typeof delta === "number" ? (
        <span
          className="text-xs font-heading"
          style={{
            color: delta > 0 ? "var(--color-success)" : delta < 0 ? "var(--color-danger)" : "var(--color-text-muted)",
          }}
        >
          {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {Math.abs(delta)}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}
