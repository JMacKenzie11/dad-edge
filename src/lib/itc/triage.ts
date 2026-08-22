import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ItcMap } from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";

/**
 * Coach-facing triage signals per in-progress ITC map. Read-only,
 * signals-only (no messaging affordances yet). Computed from data
 * already in the DB — no new tracking added.
 *
 * Health tiers, roughly ordered by severity:
 *   ok          — active in the last 3 days, no other flags
 *   stalling    — 3-6 days since last activity, no other flags
 *   overdue_test — map at test_running with target_date past today
 *                  and no result debrief
 *   stuck       — 2+ entries at the current depth stage with
 *                 attempts >= 2 and depth_score < 3 (worries,
 *                 commitments, assumptions)
 *   idle        — 7+ days since last activity, no other flags
 *
 * Multiple flags may apply; the surfaced health is the most severe.
 */

export type MapHealth =
  | "ok"
  | "stalling"
  | "idle"
  | "overdue_test"
  | "stuck";

export interface MapTriage {
  mapId: string;
  daysSinceUpdate: number;
  daysOnCurrentStage: number;
  stuckAtStage: {
    stage: "worries" | "commitments" | "assumptions";
    entries: Array<{
      id: string;
      text: string;
      attempts: number;
      depthScore: number | null;
    }>;
  } | null;
  overdueTest: {
    testId: string;
    targetDate: string;
    daysOverdue: number;
  } | null;
  health: MapHealth;
  reason: string;
}

const STUCK_TIERS: Array<"worries" | "commitments" | "assumptions"> = [
  "worries",
  "commitments",
  "assumptions",
];

export async function buildMapTriage(map: ItcMap): Promise<MapTriage> {
  const svc = createSupabaseServiceClient();
  const now = Date.now();
  const updated = new Date(map.updated_at).getTime();
  const daysSinceUpdate = Math.floor((now - updated) / (1000 * 60 * 60 * 24));

  // Days on current stage. Approximate via the earliest itc_messages row
  // with stage_at_creation === current_stage; if none (older maps), fall
  // back to updated_at. Not perfect but cheap and readable.
  let daysOnCurrentStage = daysSinceUpdate;
  const { data: firstStageMsg } = await svc
    .from("itc_messages")
    .select("created_at")
    .eq("map_id", map.id)
    .eq("stage_at_creation", map.current_stage)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const firstMsgIso = (firstStageMsg as { created_at: string } | null)
    ?.created_at;
  if (firstMsgIso) {
    daysOnCurrentStage = Math.floor(
      (now - new Date(firstMsgIso).getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  // Stuck-at-depth-stage: only compute for maps currently ON a depth
  // stage. For each entry at that stage, attempts >= 2 AND
  // depth_score < 3 means the rubric has rejected 2+ times and the
  // coachee hasn't found phrasing that passes.
  let stuckAtStage: MapTriage["stuckAtStage"] = null;
  if ((STUCK_TIERS as string[]).includes(map.current_stage)) {
    const table =
      map.current_stage === "worries"
        ? "itc_worries"
        : map.current_stage === "commitments"
          ? "itc_commitments"
          : "itc_assumptions";
    const { data } = await svc
      .from(table)
      .select("id, text, attempts, depth_score")
      .eq("map_id", map.id)
      .gte("attempts", 2)
      .or("depth_score.lt.3,depth_score.is.null");
    const rows = (data ?? []) as Array<{
      id: string;
      text: string;
      attempts: number;
      depth_score: number | null;
    }>;
    // Filter out null-depth (never scored yet) to avoid false positives —
    // "attempts >= 2 but never scored" usually means an in-flight save
    // hasn't been rubric'd yet, not stuck. Also require depth_score < 3
    // explicitly when non-null.
    const trulyStuck = rows.filter(
      (r) => r.depth_score !== null && r.depth_score < 3,
    );
    if (trulyStuck.length > 0) {
      stuckAtStage = {
        stage: map.current_stage as "worries" | "commitments" | "assumptions",
        entries: trulyStuck.map((r) => ({
          id: r.id,
          text: r.text,
          attempts: r.attempts,
          depthScore: r.depth_score,
        })),
      };
    }
  }

  // Overdue test: map at test_running, most recent designed test past
  // its target date without a result debrief.
  let overdueTest: MapTriage["overdueTest"] = null;
  if (map.current_stage === "test_running") {
    const todayIso = new Date().toISOString().slice(0, 10);
    const { data: tests } = await svc
      .from("itc_tests")
      .select("id, target_date, status")
      .eq("map_id", map.id)
      .eq("status", "designed")
      .lt("target_date", todayIso)
      .order("target_date", { ascending: true })
      .limit(1);
    const test = (tests ?? [])[0] as
      | { id: string; target_date: string; status: string }
      | undefined;
    if (test) {
      // Confirm no result already exists (would mean the coachee ran
      // it and just hasn't advanced yet).
      const { data: results } = await svc
        .from("itc_test_results")
        .select("id")
        .eq("test_id", test.id)
        .limit(1);
      if ((results ?? []).length === 0) {
        const daysOverdue = Math.floor(
          (Date.now() - new Date(`${test.target_date}T00:00:00Z`).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        overdueTest = {
          testId: test.id,
          targetDate: test.target_date,
          daysOverdue,
        };
      }
    }
  }

  // Compose health + reason. Severity descending: stuck > overdue_test
  // > idle > stalling > ok. First match wins; the "reason" text names
  // the specific signal.
  let health: MapHealth = "ok";
  let reason = "Active in the last 3 days.";

  if (stuckAtStage) {
    health = "stuck";
    const n = stuckAtStage.entries.length;
    const stageLabel = stuckAtStage.stage;
    reason = `Stuck on ${stageLabel}: ${n} entr${n === 1 ? "y" : "ies"} at 2+ attempts, still below the depth bar.`;
  } else if (overdueTest) {
    health = "overdue_test";
    reason = `Test was due ${overdueTest.targetDate} (${overdueTest.daysOverdue} day${overdueTest.daysOverdue === 1 ? "" : "s"} ago), no debrief yet.`;
  } else if (daysSinceUpdate >= 7) {
    health = "idle";
    reason = `No activity for ${daysSinceUpdate} days.`;
  } else if (daysSinceUpdate >= 3) {
    health = "stalling";
    reason = `${daysSinceUpdate} days since last activity.`;
  }

  return {
    mapId: map.id,
    daysSinceUpdate,
    daysOnCurrentStage,
    stuckAtStage,
    overdueTest,
    health,
    reason,
  };
}

/** Ordering for triage sort: most-in-need-of-help first. */
export const HEALTH_SORT_ORDER: Record<MapHealth, number> = {
  stuck: 0,
  overdue_test: 1,
  idle: 2,
  stalling: 3,
  ok: 4,
};

// Re-export so callers can name a stage in triage code without a
// second import path.
export type { ItcStage };
