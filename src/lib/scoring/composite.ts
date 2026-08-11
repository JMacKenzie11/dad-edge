/**
 * Leaderboard composite — DECISION #1: 70% Daily Living, 30% mission completion rate.
 * Both normalized to a 0..100 scale so the number reads sanely for men.
 *
 * dailyTotal  0..56  (weekly Daily Living)
 * missionRate 0..1   (completed / (completed + missed + planned-past-due-in-week))
 */
export function leaderboardComposite(dailyTotal: number, missionRate: number): number {
  const dailyNorm = Math.min(100, (dailyTotal / 56) * 100);
  const missionNorm = Math.min(100, Math.max(0, missionRate) * 100);
  return Math.round(dailyNorm * 0.7 + missionNorm * 0.3);
}
