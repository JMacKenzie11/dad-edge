import { format } from "date-fns";

type CheckinRow = { user_id: string; date: string; pillar_code: string; value: number };

/**
 * Engagement streak per user, computed from a set of checkin rows.
 * Consecutive prior days ending TODAY (in the user's timezone) that have at least one row.
 */
export function engagementStreak(rows: CheckinRow[], todayISO: string): number {
  const byDate = new Set(rows.map((r) => r.date));
  let streak = 0;
  const cursor = new Date(`${todayISO}T00:00:00`);
  while (true) {
    const key = format(cursor, "yyyy-MM-dd");
    if (byDate.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}

/**
 * Bulk engagement streaks per user. Efficient when scoring a whole community at once.
 */
export function engagementStreaksByUser(
  rows: CheckinRow[],
  todayISO: string,
): Record<string, number> {
  const perUser = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = perUser.get(r.user_id);
    if (!s) {
      s = new Set<string>();
      perUser.set(r.user_id, s);
    }
    s.add(r.date);
  }
  const out: Record<string, number> = {};
  for (const [userId, dates] of perUser) {
    let streak = 0;
    const cursor = new Date(`${todayISO}T00:00:00`);
    while (true) {
      const key = format(cursor, "yyyy-MM-dd");
      if (dates.has(key)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    out[userId] = streak;
  }
  return out;
}
