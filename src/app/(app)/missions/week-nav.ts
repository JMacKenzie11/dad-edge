/**
 * Which mission week is on screen, and where the arrows go.
 *
 * Three weeks are ever reachable: last week (only while the community
 * grace period is still open), this week, and next week (only on a
 * Sunday, to front-load Monday). Anything else — a malformed param, a
 * week that has since locked, a bookmark from three weeks ago — is a
 * redirect back to the canonical /missions rather than an error.
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
  isLastWeek: boolean;
  isNextWeek: boolean;
};

export type MissionWeekInput = {
  /** The raw ?week= value, if any. */
  requested: string | undefined;
  thisMonday: string;
  lastMonday: string;
  nextMonday: string;
  /** Last week's grace period is still open. */
  canGoBack: boolean;
  /** It's Sunday, so next week is open for planning. */
  canGoForward: boolean;
};

const MONDAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveMissionWeek(
  input: MissionWeekInput,
): MissionWeekView | { redirect: true } {
  const { requested, thisMonday, lastMonday, nextMonday, canGoBack, canGoForward } =
    input;

  let viewMonday = thisMonday;
  if (requested !== undefined) {
    // `?week=` set to this week is a redirect, not a view — the
    // current week's canonical URL is bare /missions, so a refresh or
    // a shared link always lands in the same place.
    if (!MONDAY_RE.test(requested) || requested === thisMonday) {
      return { redirect: true };
    }
    const reachable =
      (canGoBack && requested === lastMonday) ||
      (canGoForward && requested === nextMonday);
    if (!reachable) return { redirect: true };
    viewMonday = requested;
  }

  const isLastWeek = viewMonday === lastMonday;
  const isNextWeek = viewMonday === nextMonday;

  // One step at a time between the reachable weeks.
  return {
    viewMonday,
    isLastWeek,
    isNextWeek,
    prevMonday: isLastWeek
      ? null
      : isNextWeek
        ? thisMonday
        : canGoBack
          ? lastMonday
          : null,
    nextMonday: isNextWeek
      ? null
      : isLastWeek
        ? thisMonday
        : canGoForward
          ? nextMonday
          : null,
  };
}
