import { addDays, differenceInDays, format } from "date-fns";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { engagementStreaksByUser } from "@/lib/scoring/streaks";
import type { PillarCode } from "@/lib/pillars";

/**
 * Rolling window for "how consistent has this man been lately". Chosen
 * because it absorbs a bad flu week without dragging someone's shown
 * identity down, and a hot week doesn't create false status. Confirmed
 * with Jason 2026-08-25.
 */
export const ROLLING_WINDOW_WEEKS = 6;
const ROLLING_WINDOW_DAYS = ROLLING_WINDOW_WEEKS * 7;

/**
 * Per-pillar-per-day check-in cap = 1 for the 7 choose-able pillars.
 * Weekly Daily Living max = 7 pillars × 7 days = 49.
 */
const WEEKLY_DL_MAX = 49;

export type CommunityMember = {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
  city: string | null;
  role: "member" | "leader";
  /** How long they've been in this community, in weeks (min 1). */
  tenureWeeks: number;
  /** True when < ROLLING_WINDOW_WEEKS — used to render a "3 weeks in"
   *  hint under the name so short tenure doesn't read as poor
   *  performance. */
  isNewMember: boolean;

  /** Active + needs_review goals, one chip per goal. */
  goals: Array<{
    pillarCode: PillarCode;
    pillarLabel: string;
    colorVar: string;
    /** e.g. "Bond"; goal text hidden by default, shown on hover. */
    text: string;
    isItc: boolean;
  }>;

  /** Weekly average Daily Living check-ins over rolling window. Divided
   *  by min(tenureWeeks, ROLLING_WINDOW_WEEKS) so a new member with
   *  2 weeks of solid work isn't punished for the missing 4 weeks. */
  dailyLivingAvg: number;
  /** Percentage of planned missions completed over rolling window.
   *  null when the member had zero planned missions (avoids "0% but
   *  hasn't planned anything yet" false negative). */
  missionPct: number | null;
  /** Current consecutive-days-with-any-checkin streak, as of yesterday. */
  streak: number;

  /**
   * "Top this stretch" pip. Bronze/silver/gold for top 3 in the
   * community for that metric (across the rolling window). Ties break
   * alphabetically so the display is deterministic.
   */
  badges: {
    dailyLiving: BadgeTier | null;
    missions: BadgeTier | null;
    streak: BadgeTier | null;
  };

  /** Thread id if this member already has an open thread with the
   *  viewing user. When null, clicking Message goes through a
   *  server-side "create-or-fetch" resolver. */
  threadIdWithMe: string | null;
};

export type BadgeTier = "gold" | "silver" | "bronze";

/**
 * Load the People directory for the given user's primary community.
 * Server-side; runs on every /community?tab=people request. Aggregates
 * per-member so the client renders a static list.
 *
 * Deliberately uses the service client for cross-user reads — RLS
 * on daily_checkins is self-only, but this is a community roster
 * feature where members are expected to see one another's aggregated
 * stats. Only aggregates (avg / pct / streak) are surfaced; raw
 * check-in dates never leave the server.
 */
export async function loadPeopleDirectory(
  viewerId: string,
): Promise<{
  /** Names of every community the viewer belongs to, for a header
   *  label ("Boardroom X, Boardroom Y"). Multi-community is rare per
   *  Jason 2026-08-25 but we handle it silently — no picker, just
   *  merge the rosters. */
  communityNames: string[];
  members: CommunityMember[];
} | null> {
  try {
    return await resolvePeopleDirectory(viewerId);
  } catch (err) {
    console.warn(
      "[community/people] loadPeopleDirectory failed for user=%s: %s",
      viewerId,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function resolvePeopleDirectory(viewerId: string): Promise<{
  communityNames: string[];
  members: CommunityMember[];
}> {
  const svc = createSupabaseServiceClient();

  // 1. All of the viewer's active memberships. Multi-community
  //    edge case (rare): if the viewer is in Boardroom A and
  //    Boardroom B, they can see + message people from BOTH
  //    (they share a community with each of them). Dedupe by
  //    user_id in step 2 since a person can technically appear in
  //    both communities alongside them. RLS enforces the same
  //    "must share a community" rule at thread-insert time, so
  //    the client can't message anyone the server directory omits.
  const { data: myMemberships } = await svc
    .from("memberships")
    .select("community_id, communities:community_id(name)")
    .eq("user_id", viewerId)
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  const myCommunityRows = (myMemberships ?? []) as Array<{
    community_id: string;
    communities: { name: string } | { name: string }[] | null;
  }>;
  if (myCommunityRows.length === 0) {
    return { communityNames: [], members: [] };
  }
  const myCommunityIds = myCommunityRows.map((r) => r.community_id);
  const communityNames = myCommunityRows
    .map((r) => (Array.isArray(r.communities) ? r.communities[0]?.name : r.communities?.name))
    .filter((n): n is string => Boolean(n));

  // 2. Roster of every active member across every community the
  //    viewer belongs to. Dedupe by user_id since a person could
  //    appear in more than one of those communities.
  const { data: memberships } = await svc
    .from("memberships")
    .select(
      "user_id, role, joined_at, users:user_id(first_name, last_name, email, avatar_url, city)",
    )
    .in("community_id", myCommunityIds)
    .eq("status", "active");
  const rosterAll = (memberships ?? []) as Array<{
    user_id: string;
    role: "member" | "leader";
    joined_at: string;
    users:
      | {
          first_name: string | null;
          last_name: string | null;
          email: string;
          avatar_url: string | null;
          city: string | null;
        }
      | {
          first_name: string | null;
          last_name: string | null;
          email: string;
          avatar_url: string | null;
          city: string | null;
        }[]
      | null;
  }>;
  // Dedupe by user_id, keeping the EARLIEST joined_at across the
  // viewer's communities. Reason: tenure normalization for the DL
  // average should reflect how long they've been active *anywhere*
  // in the viewer's orbit, not just one community. Leader role
  // wins in the merged view if they lead any of the shared
  // communities.
  const rosterByUser = new Map<
    string,
    (typeof rosterAll)[number]
  >();
  for (const r of rosterAll) {
    const existing = rosterByUser.get(r.user_id);
    if (!existing) {
      rosterByUser.set(r.user_id, r);
      continue;
    }
    const earliestJoin =
      r.joined_at < existing.joined_at ? r.joined_at : existing.joined_at;
    rosterByUser.set(r.user_id, {
      ...existing,
      joined_at: earliestJoin,
      role: existing.role === "leader" || r.role === "leader" ? "leader" : "member",
    });
  }
  const roster = Array.from(rosterByUser.values());
  const memberIds = roster.map((r) => r.user_id);
  if (memberIds.length === 0) {
    return { communityNames, members: [] };
  }

  // 3. Rolling-window bounds. Whole days, inclusive of today so a
  //    check-in logged today counts toward the average.
  const today = format(new Date(), "yyyy-MM-dd");
  const windowStart = format(
    addDays(new Date(`${today}T00:00:00Z`), -(ROLLING_WINDOW_DAYS - 1)),
    "yyyy-MM-dd",
  );

  // 4. Bulk pulls. All queries scoped to memberIds → cheap for a
  //    12-40 person community.
  const [
    { data: checkinRows },
    { data: missionRows },
    { data: goalRows },
    { data: threadRowsA },
    { data: threadRowsB },
  ] = await Promise.all([
    svc
      .from("daily_checkins")
      .select("user_id, date, pillar_code, value")
      .in("user_id", memberIds)
      .gte("date", windowStart)
      .lte("date", today)
      .eq("value", 1),
    svc
      .from("missions")
      .select("user_id, status, target_date")
      .in("user_id", memberIds)
      .gte("target_date", windowStart)
      .lte("target_date", today),
    svc
      .from("quarterly_goals")
      .select("user_id, focus_area, desired_end_state, source, status")
      .in("user_id", memberIds)
      .in("status", ["active", "needs_review"]),
    // Threads where I'm participant_a (other user is participant_b).
    svc
      .from("message_threads")
      .select("id, participant_b")
      .eq("participant_a", viewerId),
    // Threads where I'm participant_b (other user is participant_a).
    svc
      .from("message_threads")
      .select("id, participant_a")
      .eq("participant_b", viewerId),
  ]);

  // 5. Per-user aggregates.
  const dailyLivingByUser = new Map<string, number>();
  for (const r of (checkinRows ?? []) as Array<{
    user_id: string;
    date: string;
    pillar_code: PillarCode;
    value: number;
  }>) {
    dailyLivingByUser.set(
      r.user_id,
      (dailyLivingByUser.get(r.user_id) ?? 0) + 1,
    );
  }

  const missionsPlannedByUser = new Map<string, number>();
  const missionsCompletedByUser = new Map<string, number>();
  for (const r of (missionRows ?? []) as Array<{
    user_id: string;
    status: string;
    target_date: string;
  }>) {
    // rolled_over doesn't count toward planned (matches other scoring paths).
    if (r.status === "rolled_over") continue;
    missionsPlannedByUser.set(
      r.user_id,
      (missionsPlannedByUser.get(r.user_id) ?? 0) + 1,
    );
    if (r.status === "completed") {
      missionsCompletedByUser.set(
        r.user_id,
        (missionsCompletedByUser.get(r.user_id) ?? 0) + 1,
      );
    }
  }

  const goalsByUser = new Map<
    string,
    Array<{
      pillarCode: PillarCode;
      text: string;
      isItc: boolean;
    }>
  >();
  for (const r of (goalRows ?? []) as Array<{
    user_id: string;
    focus_area: PillarCode;
    desired_end_state: string;
    source: string;
    status: string;
  }>) {
    const arr = goalsByUser.get(r.user_id) ?? [];
    arr.push({
      pillarCode: r.focus_area,
      text: r.desired_end_state,
      isItc: r.source === "itc",
    });
    goalsByUser.set(r.user_id, arr);
  }

  // Streaks. Existing helper wants a flat array of checkin rows; feed
  // it just the rolling-window data (streak looks at consecutive days
  // ending "as-of" a given date, so this window is enough).
  const streaks = engagementStreaksByUser(
    ((checkinRows ?? []) as Array<{
      user_id: string;
      date: string;
      pillar_code: PillarCode;
      value: 0 | 1;
    }>),
    format(addDays(new Date(`${today}T00:00:00Z`), -1), "yyyy-MM-dd"),
  );

  const threadByOtherUser = new Map<string, string>();
  for (const r of (threadRowsA ?? []) as Array<{ id: string; participant_b: string }>) {
    threadByOtherUser.set(r.participant_b, r.id);
  }
  for (const r of (threadRowsB ?? []) as Array<{ id: string; participant_a: string }>) {
    threadByOtherUser.set(r.participant_a, r.id);
  }

  // 6. Build member rows. Skip the viewer — the People tab is for
  //    seeing everyone ELSE. (Adding self would produce a "Message
  //    yourself" button, which the DB CHECK rejects anyway.)
  const now = new Date();
  const { PILLARS, PILLAR_BY_CODE } = await import("@/lib/pillars");
  const pillarByCode = PILLAR_BY_CODE;
  void PILLARS;

  const members: CommunityMember[] = roster
    .filter((r) => r.user_id !== viewerId)
    .map((r) => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      const first = u?.first_name ?? null;
      const last = u?.last_name ?? null;
      const email = u?.email ?? "";
      const name =
        [first, last].filter(Boolean).join(" ") || email || "Brother";

      // Tenure in weeks, min 1, capped for the average denominator at
      // the rolling window itself (a 12-week member's denominator is
      // 6, not 12 — we only pulled 6 weeks of data).
      const tenureDays = Math.max(
        1,
        differenceInDays(now, new Date(r.joined_at)),
      );
      const tenureWeeks = Math.max(1, Math.floor(tenureDays / 7));
      const denominatorWeeks = Math.min(
        ROLLING_WINDOW_WEEKS,
        Math.max(1, tenureWeeks),
      );
      const isNewMember = tenureWeeks < ROLLING_WINDOW_WEEKS;

      const dl = dailyLivingByUser.get(r.user_id) ?? 0;
      const dailyLivingAvg = dl / denominatorWeeks;

      const mp = missionsPlannedByUser.get(r.user_id) ?? 0;
      const mc = missionsCompletedByUser.get(r.user_id) ?? 0;
      const missionPct = mp === 0 ? null : (mc / mp) * 100;

      const goals = (goalsByUser.get(r.user_id) ?? []).map((g) => {
        const p = pillarByCode[g.pillarCode];
        return {
          pillarCode: g.pillarCode,
          pillarLabel: p?.label ?? String(g.pillarCode),
          colorVar: p?.colorVar ?? "var(--color-text-muted)",
          text: g.text,
          isItc: g.isItc,
        };
      });

      return {
        userId: r.user_id,
        name,
        firstName: first,
        lastName: last,
        email,
        avatarUrl: u?.avatar_url ?? null,
        city: u?.city ?? null,
        role: r.role,
        tenureWeeks,
        isNewMember,
        goals,
        dailyLivingAvg,
        missionPct,
        streak: streaks[r.user_id] ?? 0,
        badges: { dailyLiving: null, missions: null, streak: null },
        threadIdWithMe: threadByOtherUser.get(r.user_id) ?? null,
      };
    });

  // 7. Badge assignment. Top-3 per metric with alphabetical tiebreak.
  assignBadges(members, (m) => m.dailyLivingAvg, "dailyLiving");
  assignBadges(
    members,
    (m) => (m.missionPct === null ? -1 : m.missionPct),
    "missions",
  );
  assignBadges(members, (m) => m.streak, "streak");

  return { communityNames, members };
}

function assignBadges(
  members: CommunityMember[],
  score: (m: CommunityMember) => number,
  bucket: "dailyLiving" | "missions" | "streak",
): void {
  const sorted = [...members]
    .filter((m) => score(m) > 0)
    .sort((a, b) => {
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });
  const tiers: BadgeTier[] = ["gold", "silver", "bronze"];
  sorted.slice(0, 3).forEach((m, i) => {
    m.badges[bucket] = tiers[i]!;
  });
}
