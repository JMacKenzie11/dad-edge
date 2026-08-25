import { addDays, format } from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { localMonday } from "@/lib/scoring/week";

/**
 * Discriminated union returned to the /dashboard weekly-summary card.
 *
 *   ready       — a summary row exists; render `body` statically.
 *   generating  — the grace period is closed and no row exists yet;
 *                 the client should stream generation via the API
 *                 route with a typewriter reveal.
 *   not_yet     — last week's grace period is still open; render a
 *                 placeholder with `wrapsAt` so the user knows when
 *                 the summary will appear.
 *   no_activity — the user logged zero pillars last week; skip
 *                 generation entirely and show a friendly nudge to
 *                 log this week instead of a fake recap.
 */
export type WeeklySummaryState =
  | {
      status: "ready";
      weekStart: string;
      body: WeeklySummaryBody;
    }
  | {
      status: "generating";
      weekStart: string;
    }
  | {
      status: "not_yet";
      weekStart: string;
      wrapsAt: string; // ISO date of the day the summary becomes available
    }
  | {
      status: "no_activity";
      weekStart: string;
    };

export type WeeklySummaryBody = {
  highlight: string;
  what_worked: string;
  opportunity: string;
};

/**
 * Resolve the state for the summary card. Anchors to the user's
 * primary community timezone for "what week is 'last week'" (falls
 * back to UTC if they have no active membership).
 *
 * Grace period gate: uses the *earliest* week_lock_days across the
 * user's active memberships. Rationale: once the strictest community
 * has locked the week, that data is finalized — check-ins are user-
 * level, not community-level, so no more edits happen after the
 * first lock regardless of other communities' lock configs.
 */
export async function getWeeklySummaryState(
  userId: string,
  now: Date = new Date(),
): Promise<WeeklySummaryState | null> {
  try {
    return await resolveWeeklySummaryState(userId, now);
  } catch (err) {
    // Never blow up /dashboard on a summary-state read failure. The
    // card is a nice-to-have; the rest of the page (pillars, trends,
    // missions, survey, ITC) is the actual "record" surface. Log,
    // hide the card, keep the page rendering.
    console.warn(
      "[weekly-summary] getWeeklySummaryState failed for user=%s: %s",
      userId,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function resolveWeeklySummaryState(
  userId: string,
  now: Date,
): Promise<WeeklySummaryState> {
  const svc = createSupabaseServiceClient();

  // 1. What's the user's timezone? Read the earliest lock config too.
  const { data: memberships } = await svc
    .from("memberships")
    .select("communities:community_id(timezone, week_lock_days)")
    .eq("user_id", userId)
    .eq("status", "active");
  const communities = ((memberships ?? []) as {
    communities:
      | { timezone: string; week_lock_days: number }
      | { timezone: string; week_lock_days: number }[]
      | null;
  }[])
    .map((m) => (Array.isArray(m.communities) ? m.communities[0] : m.communities))
    .filter((c): c is { timezone: string; week_lock_days: number } => Boolean(c));

  // Default to UTC + 3-day lock when the user has no active
  // membership. Rare but possible (e.g. between deactivation and
  // reactivation); no reason to blow up the whole /dashboard render.
  const timezone = communities[0]?.timezone ?? "UTC";
  const earliestLockDays = communities.length
    ? Math.min(...communities.map((c) => c.week_lock_days))
    : 3;

  // 2. Last week's Monday and Sunday.
  const thisMonday = localMonday(now, timezone);
  const lastMonday = format(
    addDays(new Date(`${thisMonday}T00:00:00Z`), -7),
    "yyyy-MM-dd",
  );
  const lastSunday = format(
    addDays(new Date(`${lastMonday}T00:00:00Z`), 6),
    "yyyy-MM-dd",
  );

  // 3. Do we already have a summary for that week? (Ready path.)
  const { data: existing } = await svc
    .from("weekly_summaries")
    .select("body")
    .eq("user_id", userId)
    .eq("week_start", lastMonday)
    .maybeSingle();
  if (existing) {
    return {
      status: "ready",
      weekStart: lastMonday,
      body: (existing as { body: WeeklySummaryBody }).body,
    };
  }

  // 4. Has the grace period closed? We don't need to query the
  //    `weeks` table — the answer is deterministic from the calendar
  //    and the community's lock config: last-week's Sunday + lock
  //    days = when it locks.
  const wrapsAtDate = addDays(
    new Date(`${lastSunday}T00:00:00Z`),
    earliestLockDays,
  );
  const wrapsAt = format(wrapsAtDate, "yyyy-MM-dd");
  const today = format(now, "yyyy-MM-dd");
  if (today < wrapsAt) {
    return { status: "not_yet", weekStart: lastMonday, wrapsAt };
  }

  // 5. Grace closed. Did the user log anything last week?
  const { count } = await svc
    .from("daily_checkins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("date", lastMonday)
    .lte("date", lastSunday)
    .eq("value", 1);
  if ((count ?? 0) === 0) {
    return { status: "no_activity", weekStart: lastMonday };
  }

  return { status: "generating", weekStart: lastMonday };
}

/**
 * Slim helper for the streaming API to double-check the caller is
 * asking for a week that actually needs generating — prevents a
 * client that keeps POSTing from spamming the LLM.
 */
export async function summaryAlreadyExists(
  userId: string,
  weekStart: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("weekly_summaries")
    .select("user_id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  return Boolean(data);
}
