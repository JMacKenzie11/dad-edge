import type { PillarCode } from "@/lib/pillars";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ensureUserForItcParticipant } from "./auth-bridge";

/**
 * ITC ↔ Tracker link.
 *
 * When a coachee saves an ITC improvement goal or runs an ITC test,
 * we mirror that into the main-app tracker as a quarterly_goal /
 * mission. That way ITC work counts against the same weekly cap /
 * composite score / A2 pillar as the rest of the app, and the man's
 * accountability record is one integrated story.
 *
 * All wiring lives in this file so actions.ts doesn't sprawl. Every
 * function is idempotent — safe to re-fire on edits.
 *
 * Failure policy: tracker-link failures never block the ITC action.
 * If we can't write to quarterly_goals or missions, log a warning
 * and continue. The ITC map is the source of truth for ITC UX; the
 * tracker is a downstream mirror. A degraded state (map saved, goal
 * not mirrored) is recoverable via a re-save.
 */

//
// Helpers
//

/** ISO YYYY-MM-DD of the first day of the calendar quarter containing
 *  today (in the server's UTC clock). Quarters are Jan / Apr / Jul /
 *  Oct. Not user-timezone-aware — the tracker's quarter is a global
 *  bucket, not a per-user boundary. */
export function currentQuarterStart(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3); // 0..3
  const month = q * 3 + 1; // 1, 4, 7, 10
  return `${y}-${String(month).padStart(2, "0")}-01`;
}

/** First active community the user belongs to, if any. Used for
 *  mission creation, which requires community_id NOT NULL. ITC-only
 *  users may have no community yet; caller decides how to handle. */
async function firstActiveCommunityForUser(userId: string): Promise<string | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("community_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      "[itc tracker-link] firstActiveCommunityForUser lookup failed: %s",
      error.message,
    );
    return null;
  }
  return (data?.community_id as string | undefined) ?? null;
}

//
// Goal sync
//

/**
 * Mirror the ITC map's improvement goal into a quarterly_goals row.
 * Called from saveGoal after the ITC-side write succeeds.
 *
 * Behavior:
 *   - Ensures the participant → user bridge (creates the users row
 *     lazily if this is the first tracker-touching action).
 *   - If the map has no linked goal, creates a new quarterly_goals
 *     row in the current quarter and stores its id on itc_maps.
 *   - If the map already has a linked goal, updates the description
 *     in place (an edit) rather than creating a duplicate.
 *
 * Verbatim storage: the full goal including the "I'm committed to
 * getting better at …" stem is stored as-is. The stem is meaningful
 * — it's the ITC "improvement goal" framing.
 */
export async function syncItcGoalToTracker(input: {
  participantId: string;
  mapId: string;
  pillarCode: PillarCode;
  goalText: string;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const bridge = await ensureUserForItcParticipant(input.participantId);
  if (!bridge.ok) {
    console.warn(
      "[itc tracker-link] syncItcGoalToTracker bridge failed: %s",
      bridge.reason,
    );
    return;
  }
  const userId = bridge.userId;

  const { data: map, error: mapErr } = await supabase
    .from("itc_maps")
    .select("id, quarterly_goal_id")
    .eq("id", input.mapId)
    .maybeSingle();
  if (mapErr || !map) {
    console.warn(
      "[itc tracker-link] map lookup failed: %s",
      mapErr?.message ?? "not found",
    );
    return;
  }

  if (map.quarterly_goal_id) {
    // Edit path: update the linked quarterly_goal's description in place.
    const { error: updateErr } = await supabase
      .from("quarterly_goals")
      .update({ description: input.goalText })
      .eq("id", map.quarterly_goal_id);
    if (updateErr) {
      console.warn(
        "[itc tracker-link] goal update failed: %s",
        updateErr.message,
      );
    }
    return;
  }

  // Create path: new quarterly_goal in the current quarter, link to map.
  const quarterStart = currentQuarterStart();
  const { data: created, error: insertErr } = await supabase
    .from("quarterly_goals")
    .insert({
      user_id: userId,
      quarter_start: quarterStart,
      focus_area: input.pillarCode,
      description: input.goalText,
      status: "active",
    })
    .select("id")
    .single();
  if (insertErr || !created) {
    console.warn(
      "[itc tracker-link] goal create failed: %s",
      insertErr?.message ?? "no row",
    );
    return;
  }
  const { error: linkErr } = await supabase
    .from("itc_maps")
    .update({ quarterly_goal_id: created.id })
    .eq("id", input.mapId);
  if (linkErr) {
    console.warn(
      "[itc tracker-link] map ↔ goal link failed: %s",
      linkErr.message,
    );
  }
}

//
// Mission cap check + creation
//

export type MissionCapCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Pre-flight cap check for Run the Test. Returns { ok: true } if
 * creating a mission for the test's target_date would fit under the
 * user's weekly caps (15 total / 5 per bucket). Returns a friendly
 * reason on cap-hit. Same math the DB trigger enforces — this is a
 * pre-flight so the coachee gets a clean rejection instead of a
 * generic 500.
 */
export async function checkMissionCapForItcTest(input: {
  userId: string;
  quarterlyGoalId: string | null;
  targetDate: string;
}): Promise<MissionCapCheck> {
  const supabase = createSupabaseServiceClient();

  const targetDate = new Date(input.targetDate);
  // Monday-based week aligned with the DB trigger (date_trunc('week')
  // returns Monday in Postgres).
  const dow = targetDate.getUTCDay(); // 0..6, Sunday=0
  const daysFromMonday = (dow + 6) % 7;
  const weekStart = new Date(targetDate);
  weekStart.setUTCDate(targetDate.getUTCDate() - daysFromMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const isoStart = weekStart.toISOString().slice(0, 10);
  const isoEnd = weekEnd.toISOString().slice(0, 10);

  const { data: rows, error } = await supabase
    .from("missions")
    .select("id, quarterly_goal_id, status")
    .eq("user_id", input.userId)
    .gte("target_date", isoStart)
    .lte("target_date", isoEnd);
  if (error) {
    console.warn(
      "[itc tracker-link] cap lookup failed: %s",
      error.message,
    );
    // Fail-open: don't block ITC on a lookup error. DB trigger
    // remains the backstop.
    return { ok: true };
  }
  const counted = (rows ?? []).filter(
    (r) => r.status !== "rolled_over" && r.status !== "abandoned",
  );
  if (counted.length >= 15) {
    return {
      ok: false,
      reason:
        "You're at your mission cap for the week (15 total). Complete or postpone a mission on /missions, then try Run the Test again.",
    };
  }
  const inBucket = counted.filter(
    (r) => (r.quarterly_goal_id ?? null) === input.quarterlyGoalId,
  ).length;
  if (inBucket >= 5) {
    return {
      ok: false,
      reason: input.quarterlyGoalId
        ? "You're at your per-goal mission cap for this week (5 per goal). Complete or postpone one on /missions, then try Run the Test again."
        : "You're at your unattached mission cap for this week (5). Complete or postpone one on /missions, then try Run the Test again.",
    };
  }
  return { ok: true };
}

/**
 * Create the linked mission for an ITC test. Called from runTest
 * after the SMART review passes.
 *
 * Return shape:
 *   { ok: true, missionId: string }  — mission created and linked.
 *   { ok: true, missionId: null }    — skipped (no community for user).
 *                                      ITC-only coachees who haven't
 *                                      joined a community yet still get
 *                                      the ITC UX; the tracker mirror
 *                                      is opt-in-by-membership.
 *   { ok: false, reason: string }    — cap-hit OR DB error. Caller
 *                                      surfaces to the coachee; do NOT
 *                                      advance to test_running.
 *
 * Idempotent: if the test already has mission_id, no-op.
 *
 * Concreteness bypass: mission is created with created_by='itc'. The
 * application-level CONCRETE_VERBS validator (src/lib/validation/
 * mission.ts) exempts this flag — ITC test behaviors like "stay in
 * the room" don't fit the "call/take/book" verb list but are already
 * validated by SMART.
 */
export async function createMissionForItcTest(input: {
  mapId: string;
  testId: string;
  participantId: string;
  pillarCode: PillarCode;
  behaviorChange: string;
  targetDate: string;
}): Promise<{ ok: true; missionId: string | null } | { ok: false; reason: string }> {
  const supabase = createSupabaseServiceClient();

  const { data: test, error: testErr } = await supabase
    .from("itc_tests")
    .select("id, mission_id")
    .eq("id", input.testId)
    .maybeSingle();
  if (testErr || !test) {
    return {
      ok: false,
      reason: `Test lookup failed: ${testErr?.message ?? "not found"}`,
    };
  }
  if (test.mission_id) {
    return { ok: true, missionId: test.mission_id as string };
  }

  const bridge = await ensureUserForItcParticipant(input.participantId);
  if (!bridge.ok) {
    return { ok: false, reason: bridge.reason };
  }
  const userId = bridge.userId;

  const { data: map, error: mapErr } = await supabase
    .from("itc_maps")
    .select("quarterly_goal_id")
    .eq("id", input.mapId)
    .maybeSingle();
  if (mapErr || !map) {
    return {
      ok: false,
      reason: `Map lookup failed: ${mapErr?.message ?? "not found"}`,
    };
  }

  const communityId = await firstActiveCommunityForUser(userId);
  if (!communityId) {
    // ITC-only user with no community. Skip mission creation
    // silently — the test is still valid ITC work, it just doesn't
    // mirror to the tracker. When they join a community later, past
    // tests won't retroactively create missions (out of scope).
    console.warn(
      "[itc tracker-link] no community for user %s — skipping mission mirror",
      userId,
    );
    return { ok: true, missionId: null };
  }

  // Pre-flight cap check — friendly error if this test would push
  // the user past their weekly caps (15 total / 5 per bucket). The
  // DB trigger is the backstop; this check gives a clean rejection
  // instead of a generic 500 from a trigger raise.
  const capCheck = await checkMissionCapForItcTest({
    userId,
    quarterlyGoalId: map.quarterly_goal_id ?? null,
    targetDate: input.targetDate,
  });
  if (!capCheck.ok) {
    return { ok: false, reason: capCheck.reason };
  }

  const { data: created, error: insertErr } = await supabase
    .from("missions")
    .insert({
      user_id: userId,
      community_id: communityId,
      quarterly_goal_id: map.quarterly_goal_id ?? null,
      description: input.behaviorChange,
      pillar_code: input.pillarCode,
      target_date: input.targetDate,
      status: "planned",
      created_by: "itc",
    })
    .select("id")
    .single();
  if (insertErr || !created) {
    return {
      ok: false,
      reason: insertErr?.message ?? "Could not create mission.",
    };
  }

  const { error: linkErr } = await supabase
    .from("itc_tests")
    .update({ mission_id: created.id })
    .eq("id", input.testId);
  if (linkErr) {
    // Mission exists but not linked — log and continue. Follow-up
    // manual repair possible via admin.
    console.warn(
      "[itc tracker-link] test ↔ mission link failed: %s",
      linkErr.message,
    );
  }
  return { ok: true, missionId: created.id as string };
}

//
// Result / abandon / clear
//

/**
 * Mark the linked mission 'completed' when the coachee saves a result.
 * Any verdict counts — the mission was doing the test, not the result.
 * Idempotent: if the mission is already completed, no-op.
 */
export async function markMissionCompletedForItcTest(input: {
  testId: string;
  ranOn: string;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { data: test, error: testErr } = await supabase
    .from("itc_tests")
    .select("mission_id")
    .eq("id", input.testId)
    .maybeSingle();
  if (testErr || !test?.mission_id) {
    if (testErr) {
      console.warn(
        "[itc tracker-link] mission-complete test lookup failed: %s",
        testErr.message,
      );
    }
    return;
  }
  const { data: mission, error: missionErr } = await supabase
    .from("missions")
    .select("id, status, target_date")
    .eq("id", test.mission_id)
    .maybeSingle();
  if (missionErr || !mission) return;
  if (mission.status === "completed") return; // idempotent

  const ranOnDate = new Date(input.ranOn);
  const targetDate = new Date(mission.target_date as string);
  const completedLate = ranOnDate > targetDate;

  const { error: updateErr } = await supabase
    .from("missions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_late: completedLate,
    })
    .eq("id", mission.id);
  if (updateErr) {
    console.warn(
      "[itc tracker-link] mission-complete update failed: %s",
      updateErr.message,
    );
  }
}

/**
 * Mark the linked mission 'abandoned' when the coachee abandons an
 * in-flight ITC test. Only affects missions still in 'planned' —
 * completed / missed / rolled_over stay as-is (they represent real
 * historical work).
 */
export async function abandonMissionForItcTest(testId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { data: test, error: testErr } = await supabase
    .from("itc_tests")
    .select("mission_id")
    .eq("id", testId)
    .maybeSingle();
  if (testErr || !test?.mission_id) return;
  const { error: updateErr } = await supabase
    .from("missions")
    .update({ status: "abandoned" })
    .eq("id", test.mission_id)
    .eq("status", "planned"); // only 'planned' — leave real history alone
  if (updateErr) {
    console.warn(
      "[itc tracker-link] mission-abandon update failed: %s",
      updateErr.message,
    );
  }
}

/**
 * Cascade on map clear/reset. Marks the linked quarterly_goal
 * 'abandoned' and every linked 'planned' mission 'abandoned'. Leaves
 * completed / missed / rolled_over missions alone — they're the
 * user's real accountability record and shouldn't be rewritten.
 */
export async function cascadeItcMapClear(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();

  // 1. Find every planned mission linked to any test on this map,
  //    and abandon them.
  const { data: tests, error: testsErr } = await supabase
    .from("itc_tests")
    .select("mission_id")
    .eq("map_id", mapId);
  if (testsErr) {
    console.warn(
      "[itc tracker-link] cascade test lookup failed: %s",
      testsErr.message,
    );
  } else {
    const missionIds = (tests ?? [])
      .map((t) => t.mission_id as string | null)
      .filter((id): id is string => Boolean(id));
    if (missionIds.length > 0) {
      const { error: missionsErr } = await supabase
        .from("missions")
        .update({ status: "abandoned" })
        .in("id", missionIds)
        .eq("status", "planned");
      if (missionsErr) {
        console.warn(
          "[itc tracker-link] cascade mission-abandon failed: %s",
          missionsErr.message,
        );
      }
    }
  }

  // 2. Abandon the linked quarterly_goal (if any). Statuses other
  //    than 'active' (already abandoned / completed) are left alone.
  const { data: map, error: mapErr } = await supabase
    .from("itc_maps")
    .select("quarterly_goal_id")
    .eq("id", mapId)
    .maybeSingle();
  if (mapErr || !map?.quarterly_goal_id) return;
  const { error: goalErr } = await supabase
    .from("quarterly_goals")
    .update({ status: "abandoned" })
    .eq("id", map.quarterly_goal_id)
    .eq("status", "active");
  if (goalErr) {
    console.warn(
      "[itc tracker-link] cascade goal-abandon failed: %s",
      goalErr.message,
    );
  }
}
