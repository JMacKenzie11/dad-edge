import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { PillarCode } from "@/lib/pillars";
import { canTransitionTo, hasGoalStem, stageIndex, type ItcStage } from "./stage";

export type ItcMap = {
  id: string;
  participant_id: string;
  pillar_code: PillarCode;
  status: "in_progress" | "complete";
  current_stage: ItcStage;
  improvement_goal: string | null;
  reveal_delivered: boolean;
  walkthrough_delivered: boolean;
  created_at: string;
  updated_at: string;
};

export type ItcCommitment = {
  id: string;
  map_id: string;
  worry_id: string;
  text: string;
  created_at: string;
};

export type ItcAssumption = {
  id: string;
  map_id: string;
  sort_order: number;
  text: string;
  depth_score: number | null;
  selected_for_testing: boolean;
  coach_recommended: boolean;
  created_at: string;
};

export type ItcAssumptionCommitment = {
  assumption_id: string;
  commitment_id: string;
};

export type ItcBehavior = {
  id: string;
  map_id: string;
  sort_order: number;
  text: string;
  source: "user" | "suggested";
  selected: boolean;
  created_at: string;
};

export const MAX_SELECTED_BEHAVIORS = 5;

export type ItcWorry = {
  id: string;
  map_id: string;
  behavior_id: string;
  text: string;
  depth_score: number | null;
  created_at: string;
};

export type ItcWorryAttempt = {
  id: string;
  map_id: string;
  behavior_id: string;
  text: string;
  depth_score: number | null;
  accepted: boolean;
  reject_reason: string | null;
  created_at: string;
};

export type ItcMessage = {
  id: string;
  map_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  stage_at_creation: ItcStage;
  created_at: string;
};

export type ItcTestType =
  | "data_mining"
  | "observation"
  | "thought_experiment"
  | "behavioral";

export type ItcTestStatus = "designed" | "run" | "abandoned";

export type ItcAssumptionVerdict =
  | "held"
  | "partially_challenged"
  | "challenged";

export type ItcNextStep = "new_test" | "new_assumption" | "map_complete";

export type ItcTest = {
  id: string;
  map_id: string;
  assumption_id: string;
  test_type: ItcTestType;
  assumption_says: string | null;
  behavior_change: string | null;
  data_to_collect: string | null;
  in_order_to_find_out: string | null;
  target_date: string | null;
  status: ItcTestStatus;
  created_at: string;
};

export type ItcTestResult = {
  id: string;
  test_id: string;
  ran_on: string | null;
  what_i_did: string | null;
  data_collected: string | null;
  what_it_says_about_assumption: string | null;
  assumption_verdict: ItcAssumptionVerdict | null;
  next_step: ItcNextStep | null;
  created_at: string;
};

export async function findInProgressMap(participantId: string): Promise<ItcMap | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .eq("participant_id", participantId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findInProgressMap: ${error.message}`);
  return (data as ItcMap | null) ?? null;
}

export async function listAllMaps(): Promise<ItcMap[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listAllMaps: ${error.message}`);
  return (data ?? []) as ItcMap[];
}

export async function getMapById(mapId: string): Promise<ItcMap | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .eq("id", mapId)
    .maybeSingle();
  if (error) throw new Error(`getMapById: ${error.message}`);
  return (data as ItcMap | null) ?? null;
}

export async function getMapForParticipant(
  mapId: string,
  participantId: string,
): Promise<ItcMap | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .eq("id", mapId)
    .eq("participant_id", participantId)
    .maybeSingle();
  if (error) throw new Error(`getMapForParticipant: ${error.message}`);
  return (data as ItcMap | null) ?? null;
}

export async function deleteMap(mapId: string, participantId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .delete()
    .eq("id", mapId)
    .eq("participant_id", participantId);
  if (error) throw new Error(`deleteMap: ${error.message}`);
}

export async function createMap(
  participantId: string,
  pillarCode: PillarCode,
): Promise<ItcMap> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .insert({ participant_id: participantId, pillar_code: pillarCode })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createMap: ${error?.message ?? "no row"}`);
  return data as ItcMap;
}

/**
 * Save/replace the improvement goal. Enforces the stem — DB has no CHECK for
 * this so the app is the source of truth. Rejects with a caller-friendly
 * message the UI can render.
 */
export async function saveImprovementGoal(mapId: string, text: string): Promise<void> {
  if (!hasGoalStem(text)) {
    throw new Error(`Goal must begin with "I'm committed to getting better at".`);
  }
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ improvement_goal: text.trim() })
    .eq("id", mapId);
  if (error) throw new Error(`saveImprovementGoal: ${error.message}`);
}

export async function listBehaviors(mapId: string): Promise<ItcBehavior[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_behaviors")
    .select("*")
    .eq("map_id", mapId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listBehaviors: ${error.message}`);
  return (data ?? []) as ItcBehavior[];
}

/**
 * Insert a new behavior on the map. Refuses to create an exact-text
 * duplicate — observed failure was the same text landing twice (coach
 * double-fired across turns) with no way for the user to remove one
 * later. Comparison is case-insensitive and ignores trailing
 * punctuation so "I lie to get out." and "i lie to get out" don't
 * create two rows. When a duplicate is detected, return the existing
 * row so the caller sees "the behavior is on the map" and moves on.
 */
export async function addBehavior(
  mapId: string,
  text: string,
  source: "user" | "suggested",
): Promise<ItcBehavior> {
  const trimmed = text.trim();
  if (trimmed.length < 3) throw new Error("Behavior is too short.");
  const supabase = createSupabaseServiceClient();
  const existing = await listBehaviors(mapId);
  const normalized = normalizeBehaviorText(trimmed);
  const duplicate = existing.find(
    (b) => normalizeBehaviorText(b.text) === normalized,
  );
  if (duplicate) {
    console.warn(
      "[itc] addBehavior: refusing exact-text duplicate on map %s (text=%o)",
      mapId,
      trimmed,
    );
    return duplicate;
  }
  const sortOrder = existing.length;
  const { data, error } = await supabase
    .from("itc_behaviors")
    .insert({ map_id: mapId, text: trimmed, source, sort_order: sortOrder })
    .select("*")
    .single();
  if (error || !data) throw new Error(`addBehavior: ${error?.message ?? "no row"}`);
  return data as ItcBehavior;
}

export function normalizeBehaviorText(text: string): string {
  return normalizeMapText(text);
}

/**
 * Shared text-normalization key used by every "refuse exact-text
 * duplicate" check on the map (behaviors, assumptions, etc.). Lowercase,
 * whitespace-collapsed, straight/curly-apostrophe-normalized, trailing
 * punctuation stripped. Case-insensitive by construction so "I lie" and
 * "i lie." match.
 */
export function normalizeMapText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
}

/**
 * Replace the text of an existing behavior in place. Used by the coach's
 * replace_behavior action for consolidation — when the coachee's new
 * phrasing sharpens an existing behavior, swap the text rather than
 * create a duplicate.
 */
export async function updateBehaviorText(
  id: string,
  mapId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length < 3) throw new Error("Behavior is too short.");
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_behaviors")
    .update({ text: trimmed })
    .eq("id", id)
    .eq("map_id", mapId);
  if (error) throw new Error(`updateBehaviorText: ${error.message}`);
}

/**
 * Delete a behavior from the map. Used by the coach's remove_behavior
 * action when the coachee asks to drop one (typically a duplicate).
 *
 * Refuses to delete if a worry is already paired to the behavior —
 * once excavation has landed a fear underneath, removing the behavior
 * would orphan that worry and drop the whole coaching thread. The
 * schema uses ON DELETE CASCADE on itc_worries so the DB would silently
 * accept it; we enforce here in application code to keep the guarantee
 * explicit and give the coach a rejection reason it can react to.
 *
 * After delete, sort_order values on the remaining behaviors are
 * compacted (0, 1, 2, …) so 1-based coach indices continue to line up
 * with the visible list.
 */
export async function deleteBehavior(
  id: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const worries = await supabase
    .from("itc_worries")
    .select("id")
    .eq("map_id", mapId)
    .eq("behavior_id", id)
    .limit(1);
  if (worries.error) {
    throw new Error(`deleteBehavior worry-check: ${worries.error.message}`);
  }
  if ((worries.data ?? []).length > 0) {
    throw new Error(
      `deleteBehavior: behavior has a paired worry — remove via replace_behavior instead, or return to worries stage first.`,
    );
  }
  const { error } = await supabase
    .from("itc_behaviors")
    .delete()
    .eq("id", id)
    .eq("map_id", mapId);
  if (error) throw new Error(`deleteBehavior: ${error.message}`);
  const remaining = await listBehaviors(mapId);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].sort_order === i) continue;
    const { error: reorderErr } = await supabase
      .from("itc_behaviors")
      .update({ sort_order: i })
      .eq("id", remaining[i].id);
    if (reorderErr) {
      throw new Error(
        `deleteBehavior compact sort_order: ${reorderErr.message}`,
      );
    }
  }
}

export async function listWorries(mapId: string): Promise<ItcWorry[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_worries")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listWorries: ${error.message}`);
  return (data ?? []) as ItcWorry[];
}

export async function upsertWorry(
  mapId: string,
  behaviorId: string,
  text: string,
  depthScore: number,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const existing = await supabase
    .from("itc_worries")
    .select("id")
    .eq("map_id", mapId)
    .eq("behavior_id", behaviorId)
    .maybeSingle();
  if (existing.error) throw new Error(`upsertWorry lookup: ${existing.error.message}`);

  const trimmed = text.trim();
  if (existing.data) {
    const { error } = await supabase
      .from("itc_worries")
      .update({ text: trimmed, depth_score: depthScore })
      .eq("id", existing.data.id);
    if (error) throw new Error(`upsertWorry update: ${error.message}`);
    return;
  }

  const { error } = await supabase
    .from("itc_worries")
    .insert({ map_id: mapId, behavior_id: behaviorId, text: trimmed, depth_score: depthScore });
  if (error) throw new Error(`upsertWorry insert: ${error.message}`);
}

export async function logWorryAttempt(input: {
  mapId: string;
  behaviorId: string;
  text: string;
  depthScore: number | null;
  accepted: boolean;
  rejectReason: string | null;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("itc_worry_attempts").insert({
    map_id: input.mapId,
    behavior_id: input.behaviorId,
    text: input.text,
    depth_score: input.depthScore,
    accepted: input.accepted,
    reject_reason: input.rejectReason,
  });
  if (error) throw new Error(`logWorryAttempt: ${error.message}`);
}

export async function countWorryAttempts(behaviorId: string): Promise<number> {
  const supabase = createSupabaseServiceClient();
  const { count, error } = await supabase
    .from("itc_worry_attempts")
    .select("*", { count: "exact", head: true })
    .eq("behavior_id", behaviorId);
  if (error) throw new Error(`countWorryAttempts: ${error.message}`);
  return count ?? 0;
}

export async function listCommitments(mapId: string): Promise<ItcCommitment[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_commitments")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listCommitments: ${error.message}`);
  return (data ?? []) as ItcCommitment[];
}

/**
 * Insert a commitment paired to a worry. Refuses to create a second
 * commitment on the same worry (that's what "pairing" means — 1:1),
 * AND refuses exact-text duplicates across the map even if they'd
 * belong to different worries. Same failure family as the assumptions
 * and behaviors dupes. Returns the existing row on duplicate.
 */
export async function addCommitment(
  mapId: string,
  worryId: string,
  text: string,
): Promise<ItcCommitment> {
  const supabase = createSupabaseServiceClient();
  const existing = await listCommitments(mapId);
  const normalized = normalizeMapText(text);
  const worryDuplicate = existing.find((c) => c.worry_id === worryId);
  if (worryDuplicate) {
    console.warn(
      "[itc] addCommitment: worry %s already has a commitment on map %s — returning existing",
      worryId,
      mapId,
    );
    return worryDuplicate;
  }
  const textDuplicate = existing.find(
    (c) => normalizeMapText(c.text) === normalized,
  );
  if (textDuplicate) {
    console.warn(
      "[itc] addCommitment: refusing exact-text duplicate on map %s (text=%o)",
      mapId,
      text.trim(),
    );
    return textDuplicate;
  }
  const { data, error } = await supabase
    .from("itc_commitments")
    .insert({ map_id: mapId, worry_id: worryId, text: text.trim() })
    .select("*")
    .single();
  if (error || !data) throw new Error(`addCommitment: ${error?.message ?? "no row"}`);
  return data as ItcCommitment;
}

export async function listAssumptions(mapId: string): Promise<ItcAssumption[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_assumptions")
    .select("*")
    .eq("map_id", mapId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`listAssumptions: ${error.message}`);
  return (data ?? []) as ItcAssumption[];
}

/**
 * Insert a new assumption on the map. Refuses exact-text duplicates
 * (same normalization as addBehavior). Observed failure: coach fired
 * propose_assumption for the same cluster three times across three
 * "yes" affirmations and ended up with three identical rows in
 * column 5. When a duplicate is detected, return the existing row so
 * the caller (and any assumption→commitment link handler) proceeds
 * against a single canonical row.
 */
export async function addAssumption(
  mapId: string,
  text: string,
  depthScore: number,
): Promise<ItcAssumption> {
  const supabase = createSupabaseServiceClient();
  const existing = await listAssumptions(mapId);
  const normalized = normalizeMapText(text);
  const duplicate = existing.find(
    (a) => normalizeMapText(a.text) === normalized,
  );
  if (duplicate) {
    console.warn(
      "[itc] addAssumption: refusing exact-text duplicate on map %s (text=%o)",
      mapId,
      text.trim(),
    );
    return duplicate;
  }
  const { data, error } = await supabase
    .from("itc_assumptions")
    .insert({
      map_id: mapId,
      text: text.trim(),
      depth_score: depthScore,
      sort_order: existing.length,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`addAssumption: ${error?.message ?? "no row"}`);
  return data as ItcAssumption;
}

export async function linkAssumptionToCommitments(
  assumptionId: string,
  commitmentIds: string[],
): Promise<void> {
  if (commitmentIds.length === 0) return;
  const supabase = createSupabaseServiceClient();
  const rows = commitmentIds.map((cid) => ({
    assumption_id: assumptionId,
    commitment_id: cid,
  }));
  const { error } = await supabase
    .from("itc_assumption_commitments")
    .upsert(rows, { onConflict: "assumption_id,commitment_id" });
  if (error) throw new Error(`linkAssumptionToCommitments: ${error.message}`);
}

export async function listAssumptionLinks(
  mapId: string,
): Promise<ItcAssumptionCommitment[]> {
  const supabase = createSupabaseServiceClient();
  // Two-step: fetch commitments for scoping, then join links.
  const { data: assumptions, error: aErr } = await supabase
    .from("itc_assumptions")
    .select("id")
    .eq("map_id", mapId);
  if (aErr) throw new Error(`listAssumptionLinks: ${aErr.message}`);
  const ids = (assumptions ?? []).map((a) => a.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("itc_assumption_commitments")
    .select("assumption_id, commitment_id")
    .in("assumption_id", ids);
  if (error) throw new Error(`listAssumptionLinks: ${error.message}`);
  return (data ?? []) as ItcAssumptionCommitment[];
}

export async function setAssumptionSelected(
  assumptionId: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  // Clear all selections, then set the target. One-at-a-time enforcement.
  const clear = await supabase
    .from("itc_assumptions")
    .update({ selected_for_testing: false, coach_recommended: false })
    .eq("map_id", mapId);
  if (clear.error) throw new Error(`setAssumptionSelected clear: ${clear.error.message}`);
  const { error } = await supabase
    .from("itc_assumptions")
    .update({ selected_for_testing: true })
    .eq("id", assumptionId)
    .eq("map_id", mapId);
  if (error) throw new Error(`setAssumptionSelected: ${error.message}`);
}

export async function setAssumptionRecommended(
  assumptionId: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const clear = await supabase
    .from("itc_assumptions")
    .update({ coach_recommended: false })
    .eq("map_id", mapId);
  if (clear.error) throw new Error(`setAssumptionRecommended clear: ${clear.error.message}`);
  const { error } = await supabase
    .from("itc_assumptions")
    .update({ coach_recommended: true })
    .eq("id", assumptionId)
    .eq("map_id", mapId);
  if (error) throw new Error(`setAssumptionRecommended: ${error.message}`);
}

export async function listTests(mapId: string): Promise<ItcTest[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_tests")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listTests: ${error.message}`);
  return (data ?? []) as ItcTest[];
}

/**
 * The most recently created test on this map, regardless of status. That's
 * the "active" test for UI + coach context — status tells whether it's
 * been run yet, and listTestResults tells whether results are recorded.
 */
export async function getActiveTest(mapId: string): Promise<ItcTest | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_tests")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getActiveTest: ${error.message}`);
  return (data as ItcTest | null) ?? null;
}

/**
 * Save a designed test. Refuses exact-content duplicates for the same
 * assumption (all four text fields + type identical). Iteration paths
 * where the coachee legitimately wants a second test on the same
 * assumption will differ in at least one field, so the dedup is safe.
 */
export async function saveTestDraft(input: {
  mapId: string;
  assumptionId: string;
  testType: ItcTestType;
  assumptionSays: string;
  behaviorChange: string;
  dataToCollect: string;
  inOrderToFindOut: string;
  targetDate: string;
}): Promise<ItcTest> {
  const supabase = createSupabaseServiceClient();
  const existing = await listTests(input.mapId);
  const [
    normSays,
    normMove,
    normData,
    normFind,
  ] = [
    input.assumptionSays,
    input.behaviorChange,
    input.dataToCollect,
    input.inOrderToFindOut,
  ].map(normalizeMapText);
  const duplicate = existing.find(
    (t) =>
      t.assumption_id === input.assumptionId &&
      t.test_type === input.testType &&
      normalizeMapText(t.assumption_says ?? "") === normSays &&
      normalizeMapText(t.behavior_change ?? "") === normMove &&
      normalizeMapText(t.data_to_collect ?? "") === normData &&
      normalizeMapText(t.in_order_to_find_out ?? "") === normFind,
  );
  if (duplicate) {
    console.warn(
      "[itc] saveTestDraft: refusing exact-content duplicate on assumption %s",
      input.assumptionId,
    );
    return duplicate;
  }
  const { data, error } = await supabase
    .from("itc_tests")
    .insert({
      map_id: input.mapId,
      assumption_id: input.assumptionId,
      test_type: input.testType,
      assumption_says: input.assumptionSays.trim(),
      behavior_change: input.behaviorChange.trim(),
      data_to_collect: input.dataToCollect.trim(),
      in_order_to_find_out: input.inOrderToFindOut.trim(),
      target_date: input.targetDate,
      status: "designed",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`saveTestDraft: ${error?.message ?? "no row"}`);
  return data as ItcTest;
}

export async function markTestRun(testId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_tests")
    .update({ status: "run" })
    .eq("id", testId);
  if (error) throw new Error(`markTestRun: ${error.message}`);
}

export async function listTestResults(
  mapId: string,
): Promise<ItcTestResult[]> {
  const supabase = createSupabaseServiceClient();
  const tests = await listTests(mapId);
  if (tests.length === 0) return [];
  const testIds = tests.map((t) => t.id);
  const { data, error } = await supabase
    .from("itc_test_results")
    .select("*")
    .in("test_id", testIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listTestResults: ${error.message}`);
  return (data ?? []) as ItcTestResult[];
}

/**
 * Record test results. One result per test — if a result already
 * exists for this test_id, return the existing row instead of
 * inserting a second (would happen if the coach re-fires
 * record_test_results across turns).
 */
export async function recordTestResult(input: {
  testId: string;
  ranOn: string;
  whatIDid: string;
  dataCollected: string;
  whatItSaysAboutAssumption: string;
  assumptionVerdict: ItcAssumptionVerdict;
  nextStep: ItcNextStep;
}): Promise<ItcTestResult> {
  const supabase = createSupabaseServiceClient();
  const existingCheck = await supabase
    .from("itc_test_results")
    .select("*")
    .eq("test_id", input.testId)
    .maybeSingle();
  if (existingCheck.error) {
    throw new Error(`recordTestResult lookup: ${existingCheck.error.message}`);
  }
  if (existingCheck.data) {
    console.warn(
      "[itc] recordTestResult: refusing duplicate result for test %s — returning existing",
      input.testId,
    );
    return existingCheck.data as ItcTestResult;
  }
  const { data, error } = await supabase
    .from("itc_test_results")
    .insert({
      test_id: input.testId,
      ran_on: input.ranOn,
      what_i_did: input.whatIDid.trim(),
      data_collected: input.dataCollected.trim(),
      what_it_says_about_assumption: input.whatItSaysAboutAssumption.trim(),
      assumption_verdict: input.assumptionVerdict,
      next_step: input.nextStep,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`recordTestResult: ${error?.message ?? "no row"}`);
  // Flip status so the UI + coach context know results are on the record.
  await markTestRun(input.testId);
  return data as ItcTestResult;
}

/**
 * Clear selected_for_testing across all assumptions on this map. Used when
 * the coachee wants to pick a different assumption after results — the
 * prioritize stage re-selects one.
 */
export async function clearSelectedAssumption(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_assumptions")
    .update({ selected_for_testing: false, coach_recommended: false })
    .eq("map_id", mapId);
  if (error) throw new Error(`clearSelectedAssumption: ${error.message}`);
}

export async function markMapComplete(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ status: "complete" })
    .eq("id", mapId);
  if (error) throw new Error(`markMapComplete: ${error.message}`);
}

export async function markRevealDelivered(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ reveal_delivered: true })
    .eq("id", mapId);
  if (error) throw new Error(`markRevealDelivered: ${error.message}`);
}

export async function markWalkthroughDelivered(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ walkthrough_delivered: true })
    .eq("id", mapId);
  if (error) throw new Error(`markWalkthroughDelivered: ${error.message}`);
}

export async function listMessages(mapId: string): Promise<ItcMessage[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listMessages: ${error.message}`);
  return (data ?? []) as ItcMessage[];
}

export async function appendMessage(
  mapId: string,
  role: "user" | "assistant" | "system",
  content: string,
  stage: ItcStage,
): Promise<ItcMessage> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .insert({ map_id: mapId, role, content, stage_at_creation: stage })
    .select("*")
    .single();
  if (error || !data) throw new Error(`appendMessage: ${error?.message ?? "no row"}`);
  return data as ItcMessage;
}

/** Retag an already-appended message with a new stage. Used after
 * sendCoachMessage advances stage — the transition reply ("Locked. Now
 * column 2…") should live in the destination stage's view. */
export async function retagMessageStage(
  messageId: string,
  stage: ItcStage,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_messages")
    .update({ stage_at_creation: stage })
    .eq("id", messageId);
  if (error) throw new Error(`retagMessageStage: ${error.message}`);
}

export async function listMessagesForStage(
  mapId: string,
  stage: ItcStage,
): Promise<ItcMessage[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", mapId)
    .eq("stage_at_creation", stage)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listMessagesForStage: ${error.message}`);
  return (data ?? []) as ItcMessage[];
}

export async function advanceStage(mapId: string, from: ItcStage, to: ItcStage): Promise<void> {
  if (!canTransitionTo(from, to)) {
    throw new Error(`Illegal stage transition ${from} → ${to}.`);
  }

  // Data-integrity gates on forward transitions. Backward transitions are
  // always allowed (revisiting to hone) and skip these checks.
  const isForward = stageIndex(to) > stageIndex(from);
  if (isForward) {
    if (to === "worries") {
      const behaviors = await listBehaviors(mapId);
      const selectedCount = behaviors.filter((b) => b.selected).length;
      if (selectedCount < 1) {
        throw new Error("Add at least one behavior before moving to worries.");
      }
      if (selectedCount > MAX_SELECTED_BEHAVIORS) {
        throw new Error(
          `Consolidate to ${MAX_SELECTED_BEHAVIORS} or fewer behaviors before moving to worries. Currently on the map: ${selectedCount}.`,
        );
      }
    }
    if (to === "commitments") {
      const [behaviors, worries] = await Promise.all([
        listBehaviors(mapId),
        listWorries(mapId),
      ]);
      const selected = behaviors.filter((b) => b.selected);
      const worriesByBehavior = new Set(worries.map((w) => w.behavior_id));
      const missing = selected.filter((b) => !worriesByBehavior.has(b.id));
      if (missing.length > 0) {
        throw new Error(
          `Every selected behavior needs a worry before moving to commitments. Missing ${missing.length}: ${missing.map((b) => `"${b.text}"`).join(", ")}`,
        );
      }
    }
    if (to === "assumptions") {
      const [worries, commitments] = await Promise.all([
        listWorries(mapId),
        listCommitments(mapId),
      ]);
      const commitmentWorryIds = new Set(commitments.map((c) => c.worry_id));
      const missing = worries.filter((w) => !commitmentWorryIds.has(w.id));
      if (missing.length > 0) {
        throw new Error(
          `Every worry needs a commitment before moving to assumptions. Missing ${missing.length}.`,
        );
      }
    }
    if (to === "review") {
      const [assumptions, commitments, links] = await Promise.all([
        listAssumptions(mapId),
        listCommitments(mapId),
        listAssumptionLinks(mapId),
      ]);
      if (assumptions.length === 0) {
        throw new Error(`Add at least one Big Assumption before review.`);
      }
      const coveredCommitments = new Set(links.map((l) => l.commitment_id));
      const uncovered = commitments.filter((c) => !coveredCommitments.has(c.id));
      if (uncovered.length > 0) {
        throw new Error(
          `Every commitment must be covered by an assumption before review. Uncovered: ${uncovered.length}.`,
        );
      }
    }
    if (to === "prioritize") {
      const map = await getMapById(mapId);
      if (!map?.walkthrough_delivered) {
        throw new Error(
          `Deliver the immune-system walkthrough and get explicit readiness before moving to prioritize.`,
        );
      }
    }
    if (to === "test_design") {
      const assumptions = await listAssumptions(mapId);
      const selected = assumptions.find((a) => a.selected_for_testing);
      if (!selected) {
        throw new Error(
          `Select a Big Assumption for testing before moving to test_design.`,
        );
      }
    }
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ current_stage: to })
    .eq("id", mapId)
    .eq("current_stage", from);
  if (error) throw new Error(`advanceStage: ${error.message}`);
}
