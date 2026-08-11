import type { PillarCode } from "@/lib/pillars";

/**
 * A2 (Action) is a derived pillar — never a user check-in. It measures whether
 * the man executed the mission he set for that day.
 *
 * Semantics:
 *   - A2 = 1 iff at least one mission with target_date = D is `completed`
 *   - A2 = 0 iff any mission with target_date = D exists and none are completed
 *   - A2 = null iff no mission was set for D (blank on the grid, contributes 0
 *     to the weekly total, keeping pressure on to set daily missions)
 */
type MissionRow = {
  target_date: string;
  status: string;
};

export function deriveA2ForDate(missions: MissionRow[], dateISO: string): 0 | 1 | null {
  const forDay = missions.filter((m) => m.target_date === dateISO);
  if (forDay.length === 0) return null;
  return forDay.some((m) => m.status === "completed") ? 1 : 0;
}

export function deriveA2ByDate(
  missions: MissionRow[],
  dates: string[],
): Record<string, 0 | 1 | null> {
  const out: Record<string, 0 | 1 | null> = {};
  for (const d of dates) out[d] = deriveA2ForDate(missions, d);
  return out;
}

/**
 * Take a set of daily_checkins rows and a set of missions, and return the
 * "effective" check-in rows with A2 replaced by its derived value.
 *
 * - Any stored A2 rows are dropped (they're semantically invalid post-migration).
 * - For each date in `dates`, if A2 evaluates to 0/1, an A2 row is injected.
 */
export function applyDerivedA2<
  T extends { date: string; pillar_code: PillarCode; value: 0 | 1 },
>(
  checkins: T[],
  missions: MissionRow[],
  dates: string[],
  makeRow: (date: string, value: 0 | 1) => T,
): T[] {
  const filtered = checkins.filter((c) => c.pillar_code !== "A2");
  const derived = deriveA2ByDate(missions, dates);
  for (const d of dates) {
    const v = derived[d];
    if (v === 0 || v === 1) filtered.push(makeRow(d, v));
  }
  return filtered;
}
