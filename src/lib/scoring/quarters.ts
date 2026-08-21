/**
 * Calendar-quarter helpers. Single source of truth for quarter
 * boundaries across the app (missions header countdown, goals page
 * quarter_start default, quarter-end review cron, dashboard goal
 * bands).
 *
 * UTC-only. Per product decision (2026-08-26): quarter boundaries
 * only cross four times a year and per-user-timezone plumbing
 * across three surfaces adds more complexity than it removes ambiguity
 * for the edge case of a user near local midnight on Mar 31 / Jun 30 /
 * Sep 30 / Dec 31. Everyone shares the same UTC quarter.
 *
 * Canonical quarters: Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep,
 * Q4 = Oct–Dec. `start` is always the first of month 1/4/7/10; `end`
 * is the last day of month 3/6/9/12.
 */

export type Quarter = {
  /** First day of the quarter as ISO YYYY-MM-DD (UTC). */
  startIso: string;
  /** Last day of the quarter as ISO YYYY-MM-DD (UTC). Inclusive. */
  endIso: string;
  /** 1-based quarter number. */
  number: 1 | 2 | 3 | 4;
  /** Four-digit year. */
  year: number;
  /** Human label, e.g. "Q3 2026". */
  label: string;
};

/**
 * Compute the calendar quarter containing the given instant (UTC).
 * Defaults to now.
 */
export function getCurrentQuarter(now: Date = new Date()): Quarter {
  const year = now.getUTCFullYear();
  const monthIdx = now.getUTCMonth(); // 0..11
  const qIdx = Math.floor(monthIdx / 3); // 0..3
  const startMonth = qIdx * 3; // 0, 3, 6, 9
  const endMonth = startMonth + 2; // 2, 5, 8, 11
  const startIso = isoUTC(year, startMonth, 1);
  const endIso = isoUTC(year, endMonth, lastDayOfMonthUTC(year, endMonth));
  const number = (qIdx + 1) as 1 | 2 | 3 | 4;
  return {
    startIso,
    endIso,
    number,
    year,
    label: `Q${number} ${year}`,
  };
}

/**
 * Compute the quarter that follows the one containing `now`. Used by
 * the quarter-end review cron so a goal whose quarter has ended can
 * be found by comparing to (currentQuarter.startIso).
 */
export function getNextQuarter(now: Date = new Date()): Quarter {
  const current = getCurrentQuarter(now);
  const nextStart = new Date(`${current.endIso}T00:00:00Z`);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  return getCurrentQuarter(nextStart);
}

/**
 * Days remaining in the quarter containing `now`. Returns 0 on the
 * quarter-end day itself (the day the review flow should fire).
 * Never negative.
 */
export function daysUntilQuarterEnd(now: Date = new Date()): number {
  const q = getCurrentQuarter(now);
  const endMidnight = new Date(`${q.endIso}T23:59:59Z`);
  const ms = endMidnight.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/**
 * Compute the midpoint check-in date for a goal, given the quarter
 * end and the goal's creation time. Returns:
 *   - ISO date halfway between createdAt and quarterEnd if there's
 *     enough runway (>= MIDPOINT_MIN_RUNWAY_DAYS remaining in the
 *     quarter at creation time)
 *   - null if the goal was created too late for a midpoint to be
 *     meaningful — the quarter-end retrospective handles it instead
 *
 * Goal-relative (not calendar-fixed) so a coachee who joins mid-quarter
 * still gets a proportional check-in instead of missing it entirely.
 * See DECISIONS 2026-08-26 for the edge-case reasoning.
 */
export const MIDPOINT_MIN_RUNWAY_DAYS = 21;

export function computeMidpointCheckAt(
  quarterEndIso: string,
  createdAt: Date,
): string | null {
  const quarterEnd = new Date(`${quarterEndIso}T00:00:00Z`);
  const daysRemaining = Math.floor(
    (quarterEnd.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysRemaining < MIDPOINT_MIN_RUNWAY_DAYS) return null;
  const midpointMs =
    createdAt.getTime() + Math.floor(daysRemaining / 2) * 24 * 60 * 60 * 1000;
  return new Date(midpointMs).toISOString().slice(0, 10);
}

/**
 * Return the quarter whose `startIso` equals the given ISO date, or
 * null if the ISO doesn't match a canonical quarter start. Used to
 * validate incoming form input.
 */
export function quarterForStartIso(startIso: string): Quarter | null {
  const parts = startIso.split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  if (d !== 1) return null;
  if (![1, 4, 7, 10].includes(m)) return null;
  const q = getCurrentQuarter(new Date(Date.UTC(y, m - 1, 1)));
  return q.startIso === startIso ? q : null;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function isoUTC(year: number, monthIdx: number, day: number): string {
  const mm = String(monthIdx + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function lastDayOfMonthUTC(year: number, monthIdx: number): number {
  // Day 0 of the next month is the last day of `monthIdx`.
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}
