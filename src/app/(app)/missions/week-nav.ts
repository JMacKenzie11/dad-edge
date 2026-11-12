/**
 * Which mission week is on screen, and where the arrows go.
 *
 * Reachable weeks: next week (any day, so he can set it up before it
 * starts), this week, and every earlier week back to `firstMonday`, the
 * week of his first mission. Last week is "catch-up" while the community
 * grace period is open; every earlier week, and last week once it has
 * locked, is view-only (DECISIONS.md "Past mission weeks"). The database
 * refuses changes to a locked week whatever the page shows
 * (mission_week_lock_trg).
 *
 * Anything else (a malformed param, a date that isn't a Monday, a week
 * before his first mission, two weeks out) is a redirect back to the
 * canonical /missions rather than an error.
 *
 * Pulled out of the page so the arrow wiring can be tested. Getting
 * it wrong is invisible until someone clicks: the first cut sent
 * "back" from next week to LAST week, skipping this one.
 */
export type MissionWeekView = {
  viewMonday: string;
  /** Monday the back arrow points at, or null to disable it. */
  prevMonday: string | null;
  /** Monday the forward arrow points at, or null to disable it. */
  nextMonday: string | null;
  /** Last week while its grace period is open: close out what he set. */
  isLastWeek: boolean;
  isNextWeek: boolean;
  /** A week that has locked: look, don't touch. */
  isLocked: boolean;
};

export type MissionWeekInput = {
  /** The raw ?week= value, if any. */
  requested: string | undefined;
  thisMonday: string;
  lastMonday: string;
  nextMonday: string;
  /** Last week's grace period is still open. */
  canGoBack: boolean;
  /** Monday of the earliest week he has a mission in, or null with none. */
  firstMonday: string | null;
};

const MONDAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shift a yyyy-MM-dd date by whole weeks, in UTC so the host timezone can't move it. */
export function shiftWeek(monday: string, weeks: number): string {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function isMonday(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && d.getUTCDay() === 1;
}

export function resolveMissionWeek(
  input: MissionWeekInput,
): MissionWeekView | { redirect: true } {
  const { requested, thisMonday, lastMonday, nextMonday, canGoBack } = input;
  // The back arrow always reaches last week while it's open, even with
  // nothing in it, so he can see there's nothing to close out.
  const openFloor = canGoBack ? lastMonday : thisMonday;
  const floor = input.firstMonday && input.firstMonday < openFloor ? input.firstMonday : openFloor;

  let viewMonday = thisMonday;
  if (requested !== undefined) {
    // `?week=` set to this week is a redirect, not a view: the
    // current week's canonical URL is bare /missions, so a refresh or
    // a shared link always lands in the same place.
    if (!MONDAY_RE.test(requested) || !isMonday(requested) || requested === thisMonday) {
      return { redirect: true };
    }
    const reachable = requested === nextMonday || (requested < thisMonday && requested >= floor);
    if (!reachable) return { redirect: true };
    viewMonday = requested;
  }

  const isNextWeek = viewMonday === nextMonday;
  const isLastWeek = canGoBack && viewMonday === lastMonday;
  const isLocked = viewMonday < thisMonday && !isLastWeek;
  const back = shiftWeek(viewMonday, -1);

  // One step at a time.
  return {
    viewMonday,
    isLastWeek,
    isNextWeek,
    isLocked,
    prevMonday: back >= floor ? back : null,
    nextMonday: isNextWeek ? null : shiftWeek(viewMonday, 1),
  };
}
