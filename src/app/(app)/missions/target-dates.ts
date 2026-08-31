/**
 * Pure helper for normalizing multi-day mission dates. Lives in its
 * own module because `actions.ts` is a "use server" file — anything
 * exported from there has to be an async Server Action, which this
 * sync function is not.
 *
 * Contract: dedupe + sort ascending. Deadline is max(dates). Callers
 * that still hand in a single target_date get it wrapped into a
 * 1-element array so downstream jobs and views (which read the
 * scalar `target_date` = max) keep working after the array column
 * shipped.
 */
export function resolveTargetDates(input: {
  target_dates?: string[];
  target_date?: string;
}): { dates: string[]; deadline: string } | null {
  const raw = input.target_dates?.length
    ? input.target_dates
    : input.target_date
      ? [input.target_date]
      : [];
  if (raw.length === 0) return null;
  const dates = Array.from(new Set(raw)).sort();
  return { dates, deadline: dates[dates.length - 1] };
}

/**
 * Shift a YYYY-MM-DD date by 7 days, preserving the calendar day-of-
 * week. Used by the → NEXT WEEK carry-forward action so a mission
 * targeting M/T/F/S this week becomes M/T/F/S next week.
 *
 * Uses UTC-only date math to sidestep DST transitions: a naive local
 * Date + setDate(+7) around March / November DST can land on the same
 * wall-clock hour but a different UTC day, then serializing back to
 * ISO date shifts by ±1. UTC-only means the mapping is pure integer
 * arithmetic on the calendar day.
 */
export function shiftDatesByOneWeek(isoDates: string[]): string[] {
  return isoDates.map((iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  });
}
