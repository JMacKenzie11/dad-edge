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
 * The member's edit window: how far back they can still go to fix
 * last week's numbers, and whether last week is still open at all.
 *
 * Rule: a week stays editable until `week_lock_days` have passed
 * since it ended — the same arithmetic the week-lock job uses. Only
 * last week and this week are ever in play; anything older is closed.
 *
 * Multi-community members get the MOST PERMISSIVE window — last week
 * stays open until the grace period of EVERY community they're in has
 * run out. It used to be the most restrictive, which meant joining a
 * community with a tight lock silently shortened the member's window
 * everywhere: a man in a 3-day community and a 1-day community lost
 * his weekend on Monday morning, with nothing in the UI explaining
 * why (2026-09-21). Check-ins and missions are user-level rows, not
 * community-level, so there is one window per man, and the community
 * that gave him the most room is the one that should decide it.
 *
 * Computed from the calendar and the lock config rather than read off
 * `weeks.locked_at`, so the window is correct whether or not the
 * nightly job has run, and an admin's change to EDIT GRACE takes
 * effect immediately instead of next lock.
 */
export type EditWindow = {
  /** The member's primary community timezone (UTC with no membership). */
  timezone: string;
  /** Today, in that timezone. */
  today: string;
  /** Monday of the current week. */
  thisMonday: string;
  /** Monday of the week before. */
  lastMonday: string;
  /** True while last week can still be edited. */
  lastWeekOpen: boolean;
  /** The date last week closes for good — for UI copy. */
  lastWeekLocksOn: string;
  /** Earliest editable date: lastMonday while open, else thisMonday. */
  earliest: string;
};

export async function getEditWindow(
  userId: string,
  now: Date = new Date(),
): Promise<EditWindow> {
  const supabase = await createSupabaseServerClient();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("communities:community_id(timezone, week_lock_days)")
    .eq("user_id", userId)
    .eq("status", "active");
  const communities = ((memberships ?? []) as Array<{
    communities:
      | { timezone: string; week_lock_days: number }
      | { timezone: string; week_lock_days: number }[]
      | null;
  }>)
    .map((m) => (Array.isArray(m.communities) ? m.communities[0] : m.communities))
    .filter((c): c is { timezone: string; week_lock_days: number } => Boolean(c));

  const timezone = communities[0]?.timezone ?? "UTC";
  // No membership: fall back to the schema default rather than zero,
  // which would slam the window shut on a man between memberships.
  const graceDays = communities.length
    ? Math.max(...communities.map((c) => c.week_lock_days))
    : 3;

  return resolveEditWindow(now, timezone, graceDays);
}

/**
 * The calendar half of {@link getEditWindow}, with the membership
 * lookup already done. Pure — exported so the arithmetic can be
 * tested directly against a fixed `now`.
 */
export function resolveEditWindow(
  now: Date,
  timezone: string,
  graceDays: number,
): EditWindow {
  const today = localDate(now, timezone);
  const thisMonday = localMonday(now, timezone);
  // Parsed WITHOUT the Z: addDays and format below both work in the
  // runtime's own timezone, so the anchor has to be read the same
  // way. Parsing as UTC and formatting as local slides the result a
  // day backwards on any host west of UTC — right on Vercel, wrong
  // on a developer's laptop, which is the worst kind of wrong.
  const thisMondayDate = new Date(`${thisMonday}T00:00:00`);
  const lastMonday = format(addDays(thisMondayDate, -7), "yyyy-MM-dd");
  // Last week ended on the Sunday before this Monday. It locks
  // `graceDays` later — the job's own `daysAfterEnd >= week_lock_days`.
  const lastWeekEnd = addDays(thisMondayDate, -1);
  const lastWeekLocksOn = format(addDays(lastWeekEnd, graceDays), "yyyy-MM-dd");
  const lastWeekOpen = today < lastWeekLocksOn;

  return {
    timezone,
    today,
    thisMonday,
    lastMonday,
    lastWeekOpen,
    lastWeekLocksOn,
    earliest: lastWeekOpen ? lastMonday : thisMonday,
  };
}

/**
 * Earliest date the user can still edit on `/today` when navigating
 * back in time. Thin wrapper over {@link getEditWindow}.
 */
export async function getEarliestEditableDate(
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  return (await getEditWindow(userId, now)).earliest;
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
