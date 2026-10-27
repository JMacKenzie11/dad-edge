import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, CHALLENGE_COLUMNS, type Challenge } from "./rules";
import { buildBoard, type Board } from "./board";

/**
 * Reads for the member side. Everything goes through his own session, so
 * row-level security scopes it: he sees challenges in communities he's an
 * active member of, and the participants and missions of his
 * community-mates.
 */

/** How long an ended challenge stays on the Challenges tab. */
const ENDED_VISIBLE_DAYS = 30;

async function myCommunityIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("memberships")
    .select("community_id")
    .eq("user_id", userId)
    .eq("status", "active");
  return ((data ?? []) as { community_id: string }[]).map((r) => r.community_id);
}

export type JoinableChallenge = { challenge: Challenge; inCount: number };

/**
 * Challenges he can still join and hasn't answered: not ended, and no
 * row of his yet (in, left or "not for me"). Drives the card on Today
 * and Missions.
 */
export async function loadJoinableChallenges(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<JoinableChallenge[]> {
  const communities = await myCommunityIds(supabase, userId);
  if (communities.length === 0) return [];
  const { data: rows } = await supabase
    .from("challenges")
    .select(CHALLENGE_COLUMNS)
    .in("community_id", communities)
    .gte("ends_on", today)
    .order("starts_on");
  const challenges = (rows ?? []) as Challenge[];
  if (challenges.length === 0) return [];

  const { data: parts } = await supabase
    .from("challenge_participants")
    .select("challenge_id, user_id, status")
    .in("challenge_id", challenges.map((c) => c.id));
  const participants = (parts ?? []) as { challenge_id: string; user_id: string; status: string }[];
  const answered = new Set(participants.filter((p) => p.user_id === userId).map((p) => p.challenge_id));

  return challenges
    .filter((c) => !answered.has(c.id))
    .map((c) => ({
      challenge: c,
      inCount: participants.filter((p) => p.challenge_id === c.id && p.status === "in").length,
    }));
}

/** True when the Challenges tab has something to show. */
export async function hasVisibleChallenges(supabase: SupabaseClient, userId: string, today: string): Promise<boolean> {
  const communities = await myCommunityIds(supabase, userId);
  if (communities.length === 0) return false;
  const { count } = await supabase
    .from("challenges")
    .select("id", { count: "exact", head: true })
    .in("community_id", communities)
    .gte("ends_on", addDays(today, -ENDED_VISIBLE_DAYS));
  return (count ?? 0) > 0;
}

export type ChallengeBoard = {
  challenge: Challenge;
  board: Board;
  /** His own row's status, null if he never answered. */
  myStatus: "in" | "left" | "declined" | null;
};

export async function loadChallengeBoards(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<ChallengeBoard[]> {
  const communities = await myCommunityIds(supabase, userId);
  if (communities.length === 0) return [];
  const { data: rows } = await supabase
    .from("challenges")
    .select(CHALLENGE_COLUMNS)
    .in("community_id", communities)
    .gte("ends_on", addDays(today, -ENDED_VISIBLE_DAYS))
    .order("starts_on", { ascending: false });
  const challenges = (rows ?? []) as Challenge[];
  if (challenges.length === 0) return [];
  const ids = challenges.map((c) => c.id);

  const [{ data: parts }, { data: missions }] = await Promise.all([
    supabase
      .from("challenge_participants")
      .select("challenge_id, user_id, status, users:user_id(first_name, last_name)")
      .in("challenge_id", ids),
    supabase
      .from("missions")
      .select("challenge_id, user_id, target_date, status")
      .in("challenge_id", ids)
      .neq("status", "rolled_over"),
  ]);

  type Who = { first_name: string | null; last_name: string | null };
  const participants = ((parts ?? []) as {
    challenge_id: string;
    user_id: string;
    status: "in" | "left" | "declined";
    users: Who | Who[] | null;
  }[]).map((p) => {
    const u = Array.isArray(p.users) ? p.users[0] : p.users;
    return {
      challenge_id: p.challenge_id,
      user_id: p.user_id,
      status: p.status,
      name: [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "Unnamed brother",
    };
  });
  const allMissions = (missions ?? []) as { challenge_id: string; user_id: string; target_date: string; status: string }[];

  // Running and upcoming first, then the ended ones.
  const order = { running: 0, upcoming: 1, ended: 2 } as const;
  return challenges
    .map((c) => ({
      challenge: c,
      board: buildBoard({
        challenge: c,
        today,
        participants: participants.filter((p) => p.challenge_id === c.id),
        missions: allMissions.filter((m) => m.challenge_id === c.id),
      }),
      myStatus: participants.find((p) => p.challenge_id === c.id && p.user_id === userId)?.status ?? null,
    }))
    .sort((a, b) => order[a.board.phase] - order[b.board.phase]);
}
