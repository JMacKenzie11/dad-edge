import { z } from "zod";
import { isDomainCode, type DomainCode } from "@/lib/pillars";

/**
 * Challenges (DECISIONS.md "Challenges"). The database holds the rules
 * that protect data (supabase/migrations/20261027000001_challenges.sql);
 * this file holds the shared shapes, the leader form's validation and the
 * wording the member sees.
 */

export type Challenge = {
  id: string;
  community_id: string;
  name: string;
  pillar_code: DomainCode;
  mission_description: string;
  /** ISO weekdays, 1 = Monday .. 7 = Sunday, sorted. */
  days: number[];
  target: number;
  starts_on: string;
  ends_on: string;
};

export const CHALLENGE_COLUMNS =
  "id, community_id, name, pillar_code, mission_description, days, target, starts_on, ends_on";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "M W F", in week order. */
export function daysLetters(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => DAY_LETTERS[d - 1]).join(" ");
}

/** "Mon, Wed, Fri" for the leader list, where single letters are ambiguous. */
export function daysNames(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d - 1]).join(", ");
}

/**
 * What a week asks of him, beside the mission: "3 of M W F S each week",
 * "M W F each week", "Every day", "Any 3 days each week".
 */
export function targetLine(c: Pick<Challenge, "days" | "target">): string {
  if (c.target >= c.days.length) {
    return c.days.length === 7 ? "Every day" : `${daysLetters(c.days)} each week`;
  }
  if (c.days.length === 7) return `Any ${c.target} ${c.target === 1 ? "day" : "days"} each week`;
  return `${c.target} of ${daysLetters(c.days)} each week`;
}

/**
 * A part week (he joined midweek, or the challenge starts or ends
 * midweek) asks only for the days that week has: the target is cut to
 * the days on the mission.
 */
export function weekTarget(target: number, daysOnMission: number): number {
  return Math.max(1, Math.min(target, daysOnMission));
}

/**
 * The line under a challenge mission on /missions. Says how many of its
 * days count, when that isn't all of them.
 */
export function missionTargetNote(target: number, daysOnMission: number): string | null {
  const t = weekTarget(target, daysOnMission);
  return t < daysOnMission ? `Any ${t} of these days counts.` : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Nov 3" */
export function shortDate(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** "Nov 3 to Nov 30" */
export function challengeDates(c: Pick<Challenge, "starts_on" | "ends_on">): string {
  return `${shortDate(c.starts_on)} to ${shortDate(c.ends_on)}`;
}

/** Mondays (yyyy-MM-dd) of every week the challenge touches. */
export function challengeWeeks(startsOn: string, endsOn: string): string[] {
  const weeks: string[] = [];
  let monday = mondayOf(startsOn);
  const last = mondayOf(endsOn);
  while (monday <= last) {
    weeks.push(monday);
    monday = addDays(monday, 7);
  }
  return weeks;
}

export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1;
  return addDays(iso, 1 - isoDow);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a yyyy-MM-dd date. */
export function isoDow(iso: string): number {
  return ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** True when the dates hold at least one of the picked days. */
export function hasAPickedDay(startsOn: string, endsOn: string, days: number[]): boolean {
  for (let d = startsOn, i = 0; d <= endsOn && i < 7; d = addDays(d, 1), i++) {
    if (days.includes(isoDow(d))) return true;
  }
  return false;
}

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

/** The leader's form. `today` is the leader's own date. */
export function challengeFormSchema(today: string) {
  return z
    .object({
      name: z.string().trim().min(3, "Give the challenge a name.").max(80, "Keep the name under 80 characters."),
      pillar_code: z.string().refine(isDomainCode, "Pick Bond, Raise, Amplify, Vitality or Enjoyment."),
      mission_description: z
        .string()
        .trim()
        .min(8, "Write the mission in at least 8 characters.")
        .max(280, "Keep the mission under 280 characters."),
      days: z
        .array(z.coerce.number().int().min(1).max(7))
        .min(1, "Pick at least one day.")
        .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
      target: z.coerce.number().int().min(1, "Pick how many days count."),
      starts_on: DateString,
      ends_on: DateString,
    })
    .refine((v) => v.target <= v.days.length, {
      message: "The target can't be more than the days you picked.",
      path: ["target"],
    })
    .refine((v) => v.ends_on >= v.starts_on, { message: "The end date comes before the start date.", path: ["ends_on"] })
    .refine((v) => v.ends_on >= today, { message: "The end date has already passed.", path: ["ends_on"] })
    .refine((v) => v.ends_on <= addDays(v.starts_on, 366), {
      message: "Keep a challenge to a year or less.",
      path: ["ends_on"],
    })
    .refine((v) => hasAPickedDay(v.starts_on, v.ends_on, v.days), {
      message: "None of the picked days fall between those dates.",
      path: ["days"],
    });
}

/**
 * Turns the database's refusals into plain copy. The DETAIL codes come
 * from 20261027000001_challenges.sql.
 */
export function friendlyChallengeError(
  err: { details?: string | null; message?: string | null } | null | undefined,
  fallback = "That didn't save. Try again.",
): string {
  const detail = err?.details ?? "";
  if (detail === "challenge_locked") return "Someone has already joined, so the days, dates, target and domain are locked.";
  if (detail === "challenge_over") return "That challenge has ended.";
  if (detail === "challenge_not_found") return "That challenge isn't open to you.";
  if (detail === "challenge_tick_future") return "You can mark a day once it comes, not before.";
  if (detail === "challenge_not_joined") return "Join the challenge first.";
  if (detail === "challenge_needs_days") return "Tap the days you did. It completes itself once you hit the target.";
  if (detail === "challenge_tick_invalid") return "That day isn't one of this mission's days.";
  if (detail.startsWith("challenge_mission")) return "A challenge mission keeps the challenge's wording, days and domain.";
  return fallback;
}
