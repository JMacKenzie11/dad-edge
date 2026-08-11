import { format, differenceInCalendarDays } from "date-fns";

export type DisengagementBucket = "day3" | "day7" | "day14" | "day14plus";

/**
 * Classify a member's disengagement severity from their most recent check-in date.
 * §8 ladder: day 3 gentle, day 7 direct, day 14 leader-notified.
 */
export function classifyDisengagement(
  lastCheckinISO: string | null,
  today: Date = new Date(),
): { daysSince: number; bucket: DisengagementBucket | null } {
  if (!lastCheckinISO) return { daysSince: Infinity, bucket: "day14plus" };
  const days = differenceInCalendarDays(today, new Date(`${lastCheckinISO}T00:00:00`));
  if (days >= 14) return { daysSince: days, bucket: days >= 21 ? "day14plus" : "day14" };
  if (days >= 7) return { daysSince: days, bucket: "day7" };
  if (days >= 3) return { daysSince: days, bucket: "day3" };
  return { daysSince: days, bucket: null };
}

export function isoDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return format(d, "yyyy-MM-dd");
}
