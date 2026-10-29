import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDate } from "../../src/lib/scoring/week";
import { addDays, mondayOf } from "../../src/lib/challenges/rules";
import { addMembership, authedAs, createCommunity, createTestUser, deleteCommunities, deleteUsers, service, type TestUser } from "./helpers/supabase";

/**
 * Challenges against the dev database, each step as the real member or
 * leader (DECISIONS.md "Challenges"; 20261027000001_challenges.sql).
 * Test users keep the default America/Chicago timezone, so "today" is
 * Chicago's date.
 */

const svc = service();
const today = localDate(new Date(), "America/Chicago");
const nextMonday = addDays(mondayOf(today), 7);

let community = "";
let outsiderCommunity = "";
const users: TestUser[] = [];
let leader: SupabaseClient;
let alice: TestUser, bob: TestUser, carol: TestUser, outsider: TestUser, lead: TestUser;
const as = new Map<string, SupabaseClient>();

async function makeChallenge(fields: Record<string, unknown>) {
  const { data, error } = await leader
    .from("challenges")
    .insert({ community_id: community, name: "IT challenge", pillar_code: "V", mission_description: "Walk 10 km before work", ...fields })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function challengeMissions(userId: string, challengeId: string) {
  const { data } = await svc
    .from("missions")
    .select("id, description, target_dates, target_date, done_dates, status, pillar_code, challenge_id")
    .eq("user_id", userId)
    .eq("challenge_id", challengeId)
    .order("target_date");
  return (data ?? []) as { id: string; description: string; target_dates: string[]; target_date: string; done_dates: string[]; status: string }[];
}

beforeAll(async () => {
  community = (await createCommunity("challenges")).id;
  outsiderCommunity = (await createCommunity("challenges-other")).id;
  [alice, bob, carol, outsider, lead] = await Promise.all(
    ["ch-alice", "ch-bob", "ch-carol", "ch-outsider", "ch-leader"].map((l) => createTestUser(l)),
  );
  users.push(alice, bob, carol, outsider, lead);
  await svc.from("users").update({ subscription_status: "comped", onboarding_step: 6 }).in("id", users.map((u) => u.id));
  for (const u of [alice, bob, carol]) await addMembership(u.id, community);
  await addMembership(lead.id, community, { role: "leader" });
  await addMembership(outsider.id, outsiderCommunity);
  for (const u of users) as.set(u.id, await authedAs(u.email, u.password));
  leader = as.get(lead.id)!;
});

afterAll(async () => {
  await svc.from("missions").delete().in("user_id", users.map((u) => u.id));
  await deleteCommunities([community, outsiderCommunity]);
  await deleteUsers(users.map((u) => u.id));
});

describe("challenges", () => {
  let upcoming = "";

  it("joining creates one mission a week, on the challenge's days, for the whole challenge", async () => {
    upcoming = await makeChallenge({ days: [1, 3, 5], target: 2, starts_on: nextMonday, ends_on: addDays(nextMonday, 27) });
    const { data, error } = await as.get(alice.id)!.rpc("join_challenge", { p_challenge: upcoming });
    expect(error).toBeNull();
    expect(data).toBe(4);

    const missions = await challengeMissions(alice.id, upcoming);
    expect(missions.map((m) => m.target_dates)).toEqual(
      [0, 7, 14, 21].map((w) => [addDays(nextMonday, w), addDays(nextMonday, w + 2), addDays(nextMonday, w + 4)]),
    );
    expect(missions.every((m) => m.description === "Walk 10 km before work" && m.status === "planned")).toBe(true);

    // Joining twice doesn't double up.
    const again = await as.get(alice.id)!.rpc("join_challenge", { p_challenge: upcoming });
    expect(again.data).toBe(0);
    expect(await challengeMissions(alice.id, upcoming)).toHaveLength(4);
  });

  it("joining late starts with the days left this week", async () => {
    const running = await makeChallenge({ days: [1, 2, 3, 4, 5, 6, 7], target: 5, starts_on: addDays(today, -14), ends_on: addDays(today, 20) });
    await as.get(carol.id)!.rpc("join_challenge", { p_challenge: running });
    const missions = await challengeMissions(carol.id, running);
    const sunday = addDays(mondayOf(today), 6);
    const daysLeft = Array.from({ length: 7 }, (_, i) => addDays(today, i)).filter((d) => d <= sunday);
    expect(missions[0].target_dates).toEqual(daysLeft);
    expect(missions.every((m) => m.target_date >= today)).toBe(true);
  });

  it("a challenge mission can push a domain past two a week, and still takes a slot", async () => {
    const bobDb = as.get(bob.id)!;
    const mission = (d: string, text: string) => ({
      user_id: bob.id, community_id: community, description: text, pillar_code: "V", target_date: d, target_dates: [d], created_by: "user",
    });
    for (const [i, text] of ["Lift at 6am Monday", "Sauna after the lift"].entries()) {
      const { error } = await bobDb.from("missions").insert(mission(addDays(nextMonday, i), text));
      expect(error).toBeNull();
    }
    const { error: joinErr } = await bobDb.rpc("join_challenge", { p_challenge: upcoming });
    expect(joinErr).toBeNull();
    const { count } = await svc
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", bob.id)
      .eq("pillar_code", "V")
      .gte("target_date", nextMonday)
      .lte("target_date", addDays(nextMonday, 6));
    expect(count).toBe(3);

    // The week after: the challenge mission is one of the two.
    const wk2 = addDays(nextMonday, 7);
    expect((await bobDb.from("missions").insert(mission(wk2, "Lift at 6am Monday"))).error).toBeNull();
    const third = await bobDb.from("missions").insert(mission(addDays(wk2, 1), "Sauna after the lift"));
    expect(third.error?.details).toMatch(/^mission_cap:domain:V:/);
  });

  it("he can't change his challenge mission's wording or days", async () => {
    const [m] = await challengeMissions(alice.id, upcoming);
    const db = as.get(alice.id)!;
    expect((await db.from("missions").update({ description: "Walk 2 km" }).eq("id", m.id)).error?.details).toBe("challenge_mission_locked");
    expect((await db.from("missions").update({ target_dates: [m.target_dates[0]], target_date: m.target_dates[0] }).eq("id", m.id)).error?.details).toBe("challenge_mission_locked");
    // No COMPLETE: it completes itself once enough days are ticked.
    expect((await db.from("missions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", m.id)).error?.details).toBe("challenge_needs_days");
    // And a day still to come can't be ticked.
    expect((await db.from("missions").update({ done_dates: [m.target_dates[0]] }).eq("id", m.id)).error?.details).toBe("challenge_tick_future");
  });

  it("ticking days completes the week at its target, and unticking takes it back", async () => {
    const ticks = await makeChallenge({ name: "Ticks", days: [1, 2, 3, 4, 5, 6, 7], target: 2, starts_on: addDays(today, -14), ends_on: addDays(today, 20) });
    const db = as.get(carol.id)!;
    await db.rpc("join_challenge", { p_challenge: ticks });
    const [thisWeek] = await challengeMissions(carol.id, ticks);
    const tick = (days: string[]) => db.from("missions").update({ done_dates: days }).eq("id", thisWeek.id).select("status, done_dates, completed_at").single();

    // Joined late: only today on is his. Today counts, tomorrow doesn't yet.
    expect(thisWeek.target_dates[0]).toBe(today);
    expect((await tick([today])).data?.done_dates).toEqual([today]);
    const tomorrow = addDays(today, 1);
    if (thisWeek.target_dates.includes(tomorrow)) {
      expect((await tick([today, tomorrow])).error?.details).toBe("challenge_tick_future");
    }
    // An earlier day of the week isn't on his mission.
    if (today !== mondayOf(today)) {
      expect((await tick([addDays(today, -1), today])).error?.details).toBe("challenge_tick_invalid");
    }

    // One of two days: the week stays open (unless today is his only day
    // left, which cuts the target to one).
    const expected = thisWeek.target_dates.length === 1 ? "completed" : "planned";
    expect((await tick([today])).data?.status).toBe(expected);

    // A completed one goes back to planned when a day is taken back.
    const solo = await makeChallenge({ name: "Solo", days: [1, 2, 3, 4, 5, 6, 7], target: 1, starts_on: addDays(today, -14), ends_on: addDays(today, 20) });
    await db.rpc("join_challenge", { p_challenge: solo });
    const [soloWeek] = await challengeMissions(carol.id, solo);
    const soloTick = (days: string[]) => db.from("missions").update({ done_dates: days }).eq("id", soloWeek.id).select("status, completed_at").single();
    const done = (await soloTick([today])).data;
    expect(done?.status).toBe("completed");
    expect(done?.completed_at).not.toBeNull();
    expect((await soloTick([])).data).toEqual({ status: "planned", completed_at: null });
    expect((await soloTick([today])).data?.status).toBe("completed");

    // Another member can't tick his days.
    const { data: bobTry } = await as.get(bob.id)!.from("missions").update({ done_dates: [] }).eq("id", soloWeek.id).select("id");
    expect(bobTry ?? []).toEqual([]);
    expect((await challengeMissions(carol.id, solo))[0].status).toBe("completed");

    // Deleting the challenge: the ticked week stays as a regular mission,
    // the weeks to come go.
    expect((await leader.from("challenges").delete().eq("id", solo)).error).toBeNull();
    const { data: kept } = await svc.from("missions").select("challenge_id, status, done_dates").eq("id", soloWeek.id).single();
    expect(kept).toEqual({ challenge_id: null, status: "completed", done_dates: [today] });
    expect(await challengeMissions(carol.id, solo)).toEqual([]);
  });

  it("new wording reaches everyone's upcoming missions; the schedule locks once someone has joined", async () => {
    const { error } = await leader.from("challenges").update({ mission_description: "Walk 12 km before work" }).eq("id", upcoming);
    expect(error).toBeNull();
    const missions = await challengeMissions(alice.id, upcoming);
    expect(missions.every((m) => m.description === "Walk 12 km before work")).toBe(true);

    const locked = await leader.from("challenges").update({ days: [1, 3] }).eq("id", upcoming);
    expect(locked.error?.details).toBe("challenge_locked");
  });

  it("leaving removes his upcoming challenge missions, or keeps them as regular missions", async () => {
    await as.get(alice.id)!.rpc("leave_challenge", { p_challenge: upcoming, p_keep_missions: false });
    expect(await challengeMissions(alice.id, upcoming)).toEqual([]);

    await as.get(bob.id)!.rpc("leave_challenge", { p_challenge: upcoming, p_keep_missions: true });
    expect(await challengeMissions(bob.id, upcoming)).toHaveLength(0);
    const { count } = await svc
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", bob.id)
      .eq("description", "Walk 12 km before work")
      .is("challenge_id", null);
    expect(count).toBe(4);

    const { data: rows } = await svc.from("challenge_participants").select("user_id, status").eq("challenge_id", upcoming);
    expect(rows).toEqual(expect.arrayContaining([{ user_id: alice.id, status: "left" }, { user_id: bob.id, status: "left" }]));

    // Coming back: the weeks come back.
    expect((await as.get(alice.id)!.rpc("join_challenge", { p_challenge: upcoming })).data).toBe(4);
    expect(await challengeMissions(alice.id, upcoming)).toHaveLength(4);
  });

  it("a platform admin (a leader in every community) can join, and shows on the board", async () => {
    const admin = await createTestUser("ch-admin");
    users.push(admin);
    // Making him an admin adds him as an active leader of every community,
    // this one included (grant_admin_all_communities).
    await svc.from("users").update({ is_platform_admin: true, subscription_status: "comped", onboarding_step: 6 }).eq("id", admin.id);
    const { data: m } = await svc.from("memberships").select("role, status").eq("user_id", admin.id).eq("community_id", community).single();
    expect(m).toEqual({ role: "leader", status: "active" });

    const db = await authedAs(admin.email, admin.password);
    const { data, error } = await db.rpc("join_challenge", { p_challenge: upcoming });
    expect(error).toBeNull();
    expect(data).toBe(4);

    // His community-mates see him on the board.
    const { data: rows } = await as.get(carol.id)!.from("challenge_participants").select("user_id, status").eq("challenge_id", upcoming).eq("user_id", admin.id);
    expect(rows).toEqual([{ user_id: admin.id, status: "in" }]);
  });

  it("a member of another community can't join, and a member can't set a challenge", async () => {
    const res = await as.get(outsider.id)!.rpc("join_challenge", { p_challenge: upcoming });
    expect(res.error?.details).toBe("challenge_not_found");
    const planted = await as.get(carol.id)!
      .from("challenges")
      .insert({ community_id: community, name: "Planted", pillar_code: "B", mission_description: "Call her every lunch", days: [1], target: 1, starts_on: nextMonday, ends_on: addDays(nextMonday, 6) });
    expect(planted.error).not.toBeNull();
  });

  it("deleting a challenge removes upcoming missions with nothing ticked", async () => {
    const { error } = await leader.from("challenges").delete().eq("id", upcoming);
    expect(error).toBeNull();
    const { data } = await svc.from("missions").select("id, challenge_id").eq("user_id", alice.id).eq("description", "Walk 12 km before work");
    expect(data).toEqual([]);
  });
});
