import { addDays, format, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { PillarCode } from "@/lib/pillars";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * Earliest date the user can still edit on `/today` when navigating back
 * in time. Returns YYYY-MM-DD in the user's community timezone.
 *
 * Rule: users can edit any day up through today, back to the day AFTER
 * their community's most recent locked week. Fully-locked weeks are
 * immutable — the score would otherwise drift after the fact and
 * digests / leaderboards would silently rewrite.
 *
 * Multi-community users get the MOST RESTRICTIVE boundary — if any of
 * their communities has locked a week, that week is off-limits
 * everywhere. Rare edge case in practice but the alternative (per-
 * community edit windows) would need per-day UI, not worth it.
 *
 * Falls back to the current week's Monday when nothing is locked yet
 * (fresh app, dev DB, etc.).
 */
export async function getEarliestEditableDate(
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("community_id, communities:community_id(timezone)")
    .eq("user_id", userId)
    .eq("status", "active");
  const rows = ((memberships ?? []) as Array<{
    community_id: string;
    communities:
      | { timezone: string }
      | { timezone: string }[]
      | null;
  }>);
  const communityIds = rows.map((r) => r.community_id);
  const timezone =
    (Array.isArray(rows[0]?.communities)
      ? rows[0]?.communities[0]?.timezone
      : rows[0]?.communities?.timezone) ?? "UTC";

  const fallback = localMonday(now, timezone);
  if (communityIds.length === 0) return fallback;

  const { data: locked } = await supabase
    .from("weeks")
    .select("start_date")
    .in("community_id", communityIds)
    .not("locked_at", "is", null)
    .order("start_date", { ascending: false })
    .limit(1);
  const latestLockedStart = ((locked ?? []) as Array<{ start_date: string }>)[0]?.start_date;
  if (!latestLockedStart) return fallback;

  // Locked week runs latestLockedStart..+6. Earliest editable = +7 (next Monday).
  const earliest = format(
    addDays(new Date(`${latestLockedStart}T00:00:00Z`), 7),
    "yyyy-MM-dd",
  );
  // Guard against a future-dated week row somehow being "locked" — the
  // earliest editable should never be later than today.
  const todayLocal = localDate(now, timezone);
  return earliest > todayLocal ? todayLocal : earliest;
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
