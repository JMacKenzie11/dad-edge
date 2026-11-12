import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, format, parseISO } from "date-fns";
import { localDate, localMonday } from "@/lib/scoring/week";
import { engagementStreaksByUser } from "@/lib/scoring/streaks";
import type { CheckinRow } from "@/lib/scoring/week";
import { computeSignals, type CoachGoal, type CoachMission, type FitVerdict, type ManSignals } from "./signals";
import type { CoachingCommunity } from "./access";
import { completion, type Completion } from "./completion";

/**
 * Everything the Coaching pages show about the men in one community,
 * read with the service client after the leader check
 * (src/lib/coaching/access.ts). Coach conversations, the partner survey
 * and the family layer are never read here.
 */

export const MISSION_WEEKS_BACK = 8;
export const FOLLOWUP_FRESH_DAYS = 7;

export type Followup = { id: string; note: string | null; created_at: string; author: string; authorId: string | null };

export type CoachingMan = {
  userId: string;
  name: string;
  email: string;
  role: "member" | "leader";
  /** The person looking at the page. Listed, but not opened or reached out to. */
  isViewer: boolean;
  completion: Completion;
  lastCheckin: string | null;
  goals: CoachGoal[];
  missions: CoachMission[];
  fit: Map<string, FitVerdict>;
  signals: ManSignals;
  followups: Followup[];
};

export type CoachingWindow = { today: string; weekStart: string; from: string; quarterStart: string };

export function coachingWindow(community: CoachingCommunity, now: Date = new Date()): CoachingWindow {
  const today = localDate(now, community.timezone);
  const weekStart = localMonday(now, community.timezone);
  const from = format(addDays(parseISO(`${weekStart}T00:00:00`), -7 * MISSION_WEEKS_BACK), "yyyy-MM-dd");
  const d = parseISO(`${today}T00:00:00`);
  const quarterStart = format(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1), "yyyy-MM-dd");
  return { today, weekStart, from, quarterStart };
}

type UserRow = { first_name: string | null; last_name: string | null; email: string; is_admin_only: boolean | null };
const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? (x[0] ?? null) : x);
const displayName = (u: Pick<UserRow, "first_name" | "last_name" | "email"> | null, fallback: string) =>
  [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.email || fallback;

/**
 * Everyone on the Coaching list here: active members AND leaders (the
 * community's leaders and the platform admins who do the program; Jason,
 * 2026-11-12). Admin-only accounts, which don't do the program, are left
 * out. With `viewerId`, the viewer himself is left out too; the page
 * passes null and marks him instead.
 */
export async function coachableIds(svc: SupabaseClient, communityId: string, viewerId: string | null) {
  const { data } = await svc
    .from("memberships")
    .select("user_id, role, users:user_id(first_name, last_name, email, is_admin_only)")
    .eq("community_id", communityId)
    .in("role", ["member", "leader"])
    .eq("status", "active");
  return ((data ?? []) as { user_id: string; role: "member" | "leader"; users: UserRow | UserRow[] | null }[])
    .map((m) => ({ userId: m.user_id, role: m.role, user: one(m.users) }))
    .filter((m) => m.userId !== viewerId && m.user && !m.user.is_admin_only);
}

export async function loadCoaching(
  svc: SupabaseClient,
  community: CoachingCommunity,
  opts: { viewerId: string | null; onlyUserId?: string; now?: Date },
): Promise<{ window: CoachingWindow; men: CoachingMan[] }> {
  const window = coachingWindow(community, opts.now);
  // The viewer is listed with everyone else (he may do the program too),
  // marked so the page doesn't offer to open or reach out to himself.
  let roster = await coachableIds(svc, community.id, null);
  if (opts.onlyUserId) roster = roster.filter((r) => r.userId === opts.onlyUserId);
  const ids = roster.map((r) => r.userId);
  if (ids.length === 0) return { window, men: [] };
  const weekEnd = format(addDays(parseISO(`${window.weekStart}T00:00:00`), 6), "yyyy-MM-dd");

  const [goalsRes, missionsRes, checkinsRes, followRes] = await Promise.all([
    svc
      .from("quarterly_goals")
      .select("id, user_id, focus_area, desired_end_state, current_state, source, status, created_at, midpoint_check_at, midpoint_check_answer, retrospective_what_happened")
      .in("user_id", ids)
      .eq("quarter_start", window.quarterStart),
    svc
      .from("missions")
      .select("id, user_id, description, pillar_code, target_date, target_dates, status, completed_late, rolled_over_from_mission_id, quarterly_goal_id, quality_score")
      .in("user_id", ids)
      .gte("target_date", window.from)
      .lte("target_date", format(addDays(parseISO(`${weekEnd}T00:00:00`), 7), "yyyy-MM-dd"))
      .order("target_date", { ascending: false }),
    svc
      .from("daily_checkins")
      .select("user_id, date, pillar_code, value")
      .in("user_id", ids)
      .gte("date", format(addDays(parseISO(`${window.today}T00:00:00`), -90), "yyyy-MM-dd")),
    svc
      .from("coaching_followups")
      .select("id, member_user_id, author_user_id, note, created_at, author:author_user_id(first_name, last_name, email)")
      .eq("community_id", community.id)
      .in("member_user_id", ids)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const missions = (missionsRes.data ?? []) as (CoachMission & { user_id: string })[];
  const { data: fitRows } = missions.length
    ? await svc.from("mission_goal_fit").select("mission_id, goal_id, verdict").in("mission_id", missions.map((m) => m.id))
    : { data: [] };
  // A verdict counts only against the goal the mission is linked to now.
  const goalOf = new Map(missions.map((m) => [m.id, m.quarterly_goal_id]));
  const fit = new Map(
    ((fitRows ?? []) as { mission_id: string; goal_id: string; verdict: FitVerdict }[])
      .filter((f) => goalOf.get(f.mission_id) === f.goal_id)
      .map((f) => [f.mission_id, f.verdict] as const),
  );

  const checkins = (checkinsRes.data ?? []) as (CheckinRow & { user_id: string })[];
  const lastBy = new Map<string, string>();
  for (const c of checkins) if (!lastBy.has(c.user_id) || c.date > lastBy.get(c.user_id)!) lastBy.set(c.user_id, c.date);
  const streaks = engagementStreaksByUser(checkins, window.today);

  type FRow = { id: string; member_user_id: string; author_user_id: string | null; note: string | null; created_at: string; author: UserRow | UserRow[] | null };
  const followBy = new Map<string, Followup[]>();
  for (const f of (followRes.data ?? []) as FRow[]) {
    const list = followBy.get(f.member_user_id) ?? [];
    list.push({ id: f.id, note: f.note, created_at: f.created_at, author: displayName(one(f.author), "Someone"), authorId: f.author_user_id });
    followBy.set(f.member_user_id, list);
  }

  const goals = (goalsRes.data ?? []) as (CoachGoal & { user_id: string })[];
  const men = roster.map(({ userId, role, user }) => {
    const g = goals.filter((x) => x.user_id === userId);
    const m = missions.filter((x) => x.user_id === userId);
    const f = new Map([...fit].filter(([id]) => m.some((x) => x.id === id)));
    return {
      userId,
      name: displayName(user, userId),
      email: user?.email ?? "",
      role,
      isViewer: userId === opts.viewerId,
      completion: completion(g.filter((x) => x.status !== "abandoned"), m, window.weekStart),
      lastCheckin: lastBy.get(userId) ?? null,
      goals: g,
      missions: m,
      fit: f,
      followups: followBy.get(userId) ?? [],
      signals: computeSignals({
        goals: g,
        missions: m,
        fit: f,
        lastCheckin: lastBy.get(userId) ?? null,
        streak: streaks[userId] ?? 0,
        today: window.today,
        weekStart: window.weekStart,
      }),
    };
  });
  return { window, men };
}

/** Reached out to within the last week. */
export function recentlyReached(man: CoachingMan, now: Date = new Date()): Followup | null {
  const f = man.followups[0];
  if (!f) return null;
  return now.getTime() - new Date(f.created_at).getTime() <= FOLLOWUP_FRESH_DAYS * 86_400_000 ? f : null;
}

/**
 * Reach out: men with flags, heaviest first, skipping anyone reached in
 * the last week. Call out: men with wins.
 */
export function triage(all: CoachingMan[], now: Date = new Date()) {
  const men = all.filter((m) => !m.isViewer);
  const reachOut = men
    .filter((m) => m.signals.flags.length > 0 && !recentlyReached(m, now))
    .sort((a, b) => b.signals.weight - a.signals.weight || a.name.localeCompare(b.name));
  const callOut = men.filter((m) => m.signals.wins.length > 0).sort((a, b) => b.signals.wins.length - a.signals.wins.length || a.name.localeCompare(b.name));
  const reached = men.filter((m) => recentlyReached(m, now));
  return { reachOut, callOut, reached };
}
