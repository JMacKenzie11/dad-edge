import { addDays, format, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { PillarCode } from "@/lib/pillars";

/**
 * Compute a user's local Monday for a given moment.
 * Weeks are community-scoped (§3.weeks), but a member's "today" is anchored to their timezone.
 */
export function localMonday(now: Date, timezone: string): string {
  const zoned = toZonedTime(now, timezone);
  const monday = startOfWeek(zoned, { weekStartsOn: 1 });
  return format(monday, "yyyy-MM-dd");
}

export function localDate(now: Date, timezone: string): string {
  return format(toZonedTime(now, timezone), "yyyy-MM-dd");
}

export function weekDates(mondayISO: string): string[] {
  const start = new Date(`${mondayISO}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
}

export type CheckinRow = { date: string; pillar_code: PillarCode; value: 0 | 1 };

/**
 * Max weekly Daily Living score — 7 manually-checkable pillars
 * (B/R/A/V/E/M/N) × 7 days. A2 (Action) is scored separately via
 * mission completion — see `missionScore` below and A2 semantics in
 * scoring/action.ts.
 */
export const DAILY_PILLARS_WEEKLY_MAX = 49;

/**
 * Weekly Daily Living total: sum of 1s across the 7 manually-checkable
 * pillars × 7 days. A2 rows are excluded (Action credit comes from
 * completed missions, counted separately). Blank (no row) and 0 both
 * count as zero.
 *
 * (Renamed conceptually from "sum of 8 pillars × 7 = 56" to "sum of
 * 7 pillars × 7 = 49" — Action moved to per-completed-mission scoring
 * on 2026-08-24. The name stays for callsite continuity.)
 */
export function dailyLivingWeekTotal(rows: CheckinRow[]): number {
  return rows.reduce(
    (n, r) => n + (r.pillar_code !== "A2" && r.value === 1 ? 1 : 0),
    0,
  );
}

/**
 * Mission-based score for the week: completed count + planned count.
 * `completed` = missions where target_date is in the week AND status
 * is 'completed'. `planned` = missions with target_date in the week
 * regardless of status (includes completed, missed, rolled_over) —
 * this is the denominator: "of the missions you set for the week,
 * how many did you land." Rolled_over missions ARE included so a
 * planned-then-rolled mission still shows in the denominator.
 */
export type MissionScoreRow = {
  target_date: string;
  status: string;
};

export function missionScore(
  missions: MissionScoreRow[],
  weekIsoDates: string[],
): { completed: number; planned: number } {
  const inWeek = new Set(weekIsoDates);
  let completed = 0;
  let planned = 0;
  for (const m of missions) {
    if (!inWeek.has(m.target_date)) continue;
    planned += 1;
    if (m.status === "completed") completed += 1;
  }
  return { completed, planned };
}

/**
 * Weekly totals grouped by pillar for the week grid.
 */
export function pillarTotals(rows: CheckinRow[]): Record<PillarCode, number> {
  const acc = {} as Record<PillarCode, number>;
  for (const r of rows) {
    acc[r.pillar_code] = (acc[r.pillar_code] ?? 0) + (r.value === 1 ? 1 : 0);
  }
  return acc;
}
