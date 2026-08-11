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
 * Weekly Daily Living total per §4: sum of 1s across 8 pillars × 7 days.
 * Blank (no row) and 0 both count as zero — the app displays them differently,
 * but scoring is identical.
 */
export function dailyLivingWeekTotal(rows: CheckinRow[]): number {
  return rows.reduce((n, r) => n + (r.value === 1 ? 1 : 0), 0);
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
