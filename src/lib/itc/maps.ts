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
  /** True when the delivered walkthrough is quoting a map version the
   *  coachee has since edited (goal / behaviors / worries / commitments
   *  / assumptions / links). DB triggers flip this on any child-row
   *  change while walkthrough_delivered=true. Cleared on regenerate. */
  walkthrough_stale: boolean;
  /** True when the persisted hone_diagnostic banner is quoting a map
   *  version the coachee has since edited. Same trigger pattern as
   *  walkthrough_stale. Cleared when runHoneDiagnostic writes a new
   *  audit. */
  hone_diagnostic_stale: boolean;
  created_at: string;
  updated_at: string;
};

export type ItcCommitment = {
  id: string;
  map_id: string;
  worry_id: string;
  text: string;
  depth_score: number | null;
  /** Human-readable one-line explanation from the rubric run for this
   *  row's current text. Populated on every save alongside depth_score.
   *  Surfaced in the "Needs more depth" UI so the coachee sees WHAT
   *  specifically to sharpen. Null on legacy rows saved before this
   *  field existed (treat as "no specific feedback yet"). */
  rubric_reason: string | null;
  /** Per-criterion boolean from scoreCommitmentDepth: does the vow
   *  name the identity/outcome the paired worry fears? Persisted so
   *  the criteria module can fire a mirror-broken finding without a
   *  second LLM call. Null on legacy rows saved before this field
   *  existed (treat as unknown — no finding). */
  mirrors_worry_identity: boolean | null;
  attempts: number;
  created_at: string;
  updated_at: string;
};

export type ItcAssumption = {
  id: string;
  map_id: string;
  sort_order: number;
  text: string;
  depth_score: number | null;
  /** See ItcCommitment.rubric_reason. */
  rubric_reason: string | null;
  attempts: number;
  selected_for_testing: boolean;
  created_at: string;
  updated_at: string;
};

export type ItcAssumptionCommitment = {
  assumption_id: string;
  commitment_id: string;
};

/**
 * Coach-drafted Big Assumption offered as a Column 5 suggestion card.
 * `commitment_ids` lists the commitments this draft would underwrite
 * (many-to-many — one draft usually covers several commitments). The
 * draft becomes real map state only when the user taps "Use this
 * draft" (server writes an itc_assumptions row + copies links + deletes
 * the draft) or writes their own from scratch. Not a persisted view
 * of an assumption — assumptions live in itc_assumptions.
 */
export type ItcAssumptionDraft = {
  id: string;
  map_id: string;
  text: string;
  commitment_ids: string[];
  created_at: string;
};

export type ItcBehavior = {
  id: string;
  map_id: string;
  sort_order: number;
  text: string;
  source: "user" | "suggested";
  selected: boolean;
  /** Server rubric score 0-3. Same excavation-loop shape as ItcWorry
   *  — deterministic Haiku rubric writes this on every save; the
   *  Continue-to-Worries gate reads it via worryPassesDepth. Null on
   *  fresh rows until the first rubric pass completes. */
  depth_score: number | null;
  /** See ItcWorry.rubric_reason. Short human-readable string from the
   *  rubric explaining what would raise a failing criterion. Rendered
   *  by the "One thing to sharpen" UI on shallow rows. */
  rubric_reason: string | null;
  /** Number of times this behavior has been saved (add + every edit).
   *  Powers the 2/3-with-attempts>=2 escape hatch in the gate. */
  attempts: number;
  /** Coach-drafted worry text for this behavior — populated by the
   *  server pipeline on advance to Column 3. Metadata, not map
   *  content: converts to real worry.text only when the user
   *  explicitly accepts (Use this draft) or types their own. */
  coach_worry_draft: string | null;
  created_at: string;
};

export const MAX_SELECTED_BEHAVIORS = 5;

export type ItcWorry = {
  id: string;
  map_id: string;
  behavior_id: string;
  text: string;
  depth_score: number | null;
  /** See ItcCommitment.rubric_reason. */
  rubric_reason: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
};

export type ItcMessageSurface =
  | "stage_note"
  | "entry_thread"
  | "focus"
  | "dock"
  // End-of-column coach audit rendered at the bottom of a completed
  // column above the Continue button. See ColumnReview in map-canvas
  // + ensureColumnReviewDelivered in actions.ts. Deleted on any entry
  // add/edit/delete inside that column so the next render regenerates
  // against fresh state (migration 20260828000003).
  | "column_review"
  // On-demand whole-map audit. Delivered when the coachee clicks
  // "HONE THIS MAP" on the canvas; deleted by ANY entry write on
  // the map so the next click regenerates against fresh state.
  // Rendered as a banner at the top of the canvas, not inline in a
  // section. Only one per map at a time. (Migration
  // 20260828000004.)
  | "hone_diagnostic";

export type ItcMessage = {
  id: string;
  map_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  stage_at_creation: ItcStage;
  surface: ItcMessageSurface | null;
  entry_ref_table: string | null;
  entry_ref_id: string | null;
  created_at: string;
};

export type ItcTestType =
  | "data_mining"
  | "observation"
  | "thought_experiment"
  | "behavioral";

export type ItcTestStatus = "designed" | "run" | "abandoned" | "superseded";

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
  /** Snapshot of the assumption's text at the moment this test row was
   *  created. Written once by saveTestDraft; never mutates after. If
   *  the coachee later sharpens the assumption, the results view can
   *  compare this snapshot against the live assumption text and offer
   *  a "supersede this test" affordance. Null on legacy rows created
   *  before this field existed. */
  assumption_text_at_design: string | null;
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

export async function listAllMaps(): Promise<ItcMap[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listAllMaps: ${error.message}`);
  return (data ?? []) as ItcMap[];
}

/**
 * All maps owned by one participant, newest-updated first. Used by the
 * /itc landing page so the user can see prior + in-progress maps and
 * pick one to continue.
 */
export async function listMapsForParticipant(
  participantId: string,
): Promise<ItcMap[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .eq("participant_id", participantId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listMapsForParticipant: ${error.message}`);
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
): Promise<{ row: ItcBehavior; deduped: boolean }> {
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
    return { row: duplicate, deduped: true };
  }
  const sortOrder = existing.length;
  const { data, error } = await supabase
    .from("itc_behaviors")
    .insert({
      map_id: mapId,
      text: trimmed,
      source,
      sort_order: sortOrder,
      // First save counts as attempt 1 — mirrors upsertWorryForBehavior
      // so the 2/3-with-attempts>=2 gate escape hatch behaves the same
      // across all four columns.
      attempts: 1,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`addBehavior: ${error?.message ?? "no row"}`);
  return { row: data as ItcBehavior, deduped: false };
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
 * create a duplicate. Also called by updateBehavior server action on
 * inline edits.
 *
 * Bumps attempts and clears stale depth_score + rubric_reason so the
 * caller (updateBehavior) can re-score against the new text. Returns
 * the updated row so the caller can log/react without a second read.
 */
export async function updateBehaviorText(
  id: string,
  mapId: string,
  text: string,
): Promise<ItcBehavior> {
  const trimmed = text.trim();
  if (trimmed.length < 3) throw new Error("Behavior is too short.");
  const supabase = createSupabaseServiceClient();
  const existing = await supabase
    .from("itc_behaviors")
    .select("attempts")
    .eq("id", id)
    .eq("map_id", mapId)
    .maybeSingle();
  if (existing.error) throw new Error(`updateBehaviorText lookup: ${existing.error.message}`);
  if (!existing.data) throw new Error("Behavior not on this map.");
  const { data, error } = await supabase
    .from("itc_behaviors")
    .update({
      text: trimmed,
      attempts: (existing.data.attempts ?? 0) + 1,
      depth_score: null,
      rubric_reason: null,
    })
    .eq("id", id)
    .eq("map_id", mapId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`updateBehaviorText: ${error?.message ?? "no row"}`);
  return data as ItcBehavior;
}

export async function updateBehaviorDepth(
  behaviorId: string,
  score: number,
  reason?: string | null,
): Promise<void> {
  if (score < 0 || score > 3 || !Number.isInteger(score)) {
    throw new Error(`updateBehaviorDepth: score must be int 0-3, got ${score}`);
  }
  const supabase = createSupabaseServiceClient();
  const patch: { depth_score: number; rubric_reason?: string | null } = {
    depth_score: score,
  };
  if (reason !== undefined) {
    patch.rubric_reason = reason?.trim() || null;
  }
  const { error } = await supabase
    .from("itc_behaviors")
    .update(patch)
    .eq("id", behaviorId);
  if (error) throw new Error(`updateBehaviorDepth: ${error.message}`);
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
      "You wrote a worry paired to this behavior. Clear the worry first, then you can remove the behavior.",
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

/**
 * Every worry stored in the map MUST start with "I worry that..." so
 * the whole map reads with the same voice. Two failure paths were
 * letting non-conforming worries through: (a) the coach chat LLM
 * occasionally violates the prompt rule and emits "I fear being X"
 * inside a <<propose_worry>> marker; (b) coachees can type freely in
 * the worry form. Enforcing the shape at the DB boundary catches
 * both.
 *
 * If the incoming text already starts with "I worry", pass through.
 * Otherwise transform the known near-synonym stems ("I fear...",
 * "I'm afraid..."), or as a last resort prepend "I worry that ".
 */
export function normalizeWorryPrefix(text: string): string {
  const s = text.trim();
  if (!s) return s;
  if (/^I worry\b/i.test(s)) return s;
  const transforms: Array<[RegExp, string]> = [
    [/^I fear being /i, "I worry that I'd be "],
    [/^I['’`]m afraid of being /i, "I worry that I'd be "],
    [/^I fear that /i, "I worry that "],
    [/^I['’`]m afraid that /i, "I worry that "],
    [/^I fear /i, "I worry that "],
    [/^I['’`]m afraid /i, "I worry that "],
    [/^My (fear|worry) is that /i, "I worry that "],
    [/^My (fear|worry) is /i, "I worry that "],
    [/^What I('m| am) afraid of is /i, "I worry that "],
  ];
  for (const [pattern, repl] of transforms) {
    if (pattern.test(s)) return s.replace(pattern, repl);
  }
  const first = s.charAt(0);
  const body = first === "I" ? s : first.toLowerCase() + s.slice(1);
  return `I worry that ${body}`;
}

/**
 * Insert-or-update the worry paired to a behavior. One worry per
 * behavior (pairing rule). Increments `attempts` on every save so
 * the Continue gate can grant a pass at depth_score=2 after two
 * honest attempts. `depth_score` is left null here — the caller
 * (saveWorry server action) runs the rubric and stores the score
 * via updateWorryDepth in a second step.
 *
 * Text is normalized through normalizeWorryPrefix on the way in so
 * every stored worry starts with "I worry that...".
 */
export async function upsertWorryForBehavior(
  mapId: string,
  behaviorId: string,
  text: string,
): Promise<{ row: ItcWorry; isEdit: boolean }> {
  const trimmed = normalizeWorryPrefix(text.trim());
  if (trimmed.length < 3) throw new Error("Worry is too short.");
  const supabase = createSupabaseServiceClient();
  const lookup = await supabase
    .from("itc_worries")
    .select("*")
    .eq("map_id", mapId)
    .eq("behavior_id", behaviorId)
    .maybeSingle();
  if (lookup.error) throw new Error(`upsertWorryForBehavior lookup: ${lookup.error.message}`);
  if (lookup.data) {
    const existing = lookup.data as ItcWorry;
    const { data, error } = await supabase
      .from("itc_worries")
      .update({
        text: trimmed,
        attempts: (existing.attempts ?? 0) + 1,
        // Clear stale score + reason; caller re-scores immediately.
        depth_score: null,
        rubric_reason: null,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !data) throw new Error(`upsertWorryForBehavior update: ${error?.message ?? "no row"}`);
    return { row: data as ItcWorry, isEdit: true };
  }
  const { data, error } = await supabase
    .from("itc_worries")
    .insert({
      map_id: mapId,
      behavior_id: behaviorId,
      text: trimmed,
      attempts: 1,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`upsertWorryForBehavior insert: ${error?.message ?? "no row"}`);
  return { row: data as ItcWorry, isEdit: false };
}

export async function updateWorryDepth(
  worryId: string,
  score: number,
  reason?: string | null,
): Promise<void> {
  if (score < 0 || score > 3 || !Number.isInteger(score)) {
    throw new Error(`updateWorryDepth: score must be int 0-3, got ${score}`);
  }
  const supabase = createSupabaseServiceClient();
  const patch: { depth_score: number; rubric_reason?: string | null } = {
    depth_score: score,
  };
  if (reason !== undefined) {
    patch.rubric_reason = reason?.trim() || null;
  }
  const { error } = await supabase
    .from("itc_worries")
    .update(patch)
    .eq("id", worryId);
  if (error) throw new Error(`updateWorryDepth: ${error.message}`);
}

/**
 * Store the coach's drafted commitment text on the worry row. Called
 * by the advance pipeline when moving into the commitments stage —
 * one derivation per worry, run in parallel. Unlike worries and
 * assumptions, commitments are NOT drafts: the derived text writes
 * straight to itc_commitments.text via the standard save pipeline.
 * See autoDeriveCommitmentForWorry in src/app/itc/actions.ts.
 */
/**
 * Delete every itc_assumption_drafts row for a map. Used by
 * regenerateAssumptionDrafts. Real itc_assumptions rows (already
 * accepted) are untouched.
 */
export async function clearAssumptionDraftsForMap(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_assumption_drafts")
    .delete()
    .eq("map_id", mapId);
  if (error) throw new Error(`clearAssumptionDraftsForMap: ${error.message}`);
}

export async function setBehaviorWorryDraft(
  behaviorId: string,
  draftText: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_behaviors")
    .update({ coach_worry_draft: draftText.trim() })
    .eq("id", behaviorId);
  if (error) throw new Error(`setBehaviorWorryDraft: ${error.message}`);
}

/**
 * Null out coach_worry_draft on behaviors that don't have a real
 * paired worry yet. Used by regenerateWorryDrafts so the drafter
 * refills them against current behavior text after upstream edits.
 * Behaviors with real worries are untouched (the draft has already
 * been superseded by user content).
 */
export async function clearWorryDraftsForMap(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { data: worries, error: wErr } = await supabase
    .from("itc_worries")
    .select("behavior_id")
    .eq("map_id", mapId);
  if (wErr) throw new Error(`clearWorryDraftsForMap: ${wErr.message}`);
  const behaviorsWithWorries = new Set(
    (worries ?? []).map((w) => w.behavior_id as string),
  );
  const { data: behaviors, error: bErr } = await supabase
    .from("itc_behaviors")
    .select("id")
    .eq("map_id", mapId)
    .not("coach_worry_draft", "is", null);
  if (bErr) throw new Error(`clearWorryDraftsForMap behaviors: ${bErr.message}`);
  const clearIds = (behaviors ?? [])
    .map((b) => b.id as string)
    .filter((id) => !behaviorsWithWorries.has(id));
  if (clearIds.length === 0) return;
  const { error: upErr } = await supabase
    .from("itc_behaviors")
    .update({ coach_worry_draft: null })
    .in("id", clearIds);
  if (upErr) throw new Error(`clearWorryDraftsForMap update: ${upErr.message}`);
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
 * Insert-or-update the commitment paired to a worry. One commitment
 * per worry (pairing rule). Increments `attempts` on every save so
 * the Continue gate can grant a pass at depth_score=2 after two
 * honest attempts. `depth_score` is cleared here; the caller
 * (saveCommitment server action) runs the rubric and stores the
 * fresh score in a second step.
 */
export async function upsertCommitmentForWorry(
  mapId: string,
  worryId: string,
  text: string,
): Promise<{ row: ItcCommitment; isEdit: boolean }> {
  const trimmed = text.trim();
  if (trimmed.length < 3) throw new Error("Commitment is too short.");
  const supabase = createSupabaseServiceClient();
  const lookup = await supabase
    .from("itc_commitments")
    .select("*")
    .eq("map_id", mapId)
    .eq("worry_id", worryId)
    .maybeSingle();
  if (lookup.error) throw new Error(`upsertCommitmentForWorry lookup: ${lookup.error.message}`);
  if (lookup.data) {
    const existing = lookup.data as ItcCommitment;
    const { data, error } = await supabase
      .from("itc_commitments")
      .update({
        text: trimmed,
        attempts: (existing.attempts ?? 0) + 1,
        // Clear stale score + reason; caller re-scores immediately.
        depth_score: null,
        rubric_reason: null,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !data) throw new Error(`upsertCommitmentForWorry update: ${error?.message ?? "no row"}`);
    return { row: data as ItcCommitment, isEdit: true };
  }
  const { data, error } = await supabase
    .from("itc_commitments")
    .insert({
      map_id: mapId,
      worry_id: worryId,
      text: trimmed,
      attempts: 1,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`upsertCommitmentForWorry insert: ${error?.message ?? "no row"}`);
  return { row: data as ItcCommitment, isEdit: false };
}

export async function updateCommitmentDepth(
  commitmentId: string,
  score: number,
  reason?: string | null,
  mirrorsWorryIdentity?: boolean | null,
): Promise<void> {
  if (score < 0 || score > 3 || !Number.isInteger(score)) {
    throw new Error(`updateCommitmentDepth: score must be int 0-3, got ${score}`);
  }
  const supabase = createSupabaseServiceClient();
  const patch: {
    depth_score: number;
    rubric_reason?: string | null;
    mirrors_worry_identity?: boolean | null;
  } = {
    depth_score: score,
  };
  if (reason !== undefined) {
    patch.rubric_reason = reason?.trim() || null;
  }
  if (mirrorsWorryIdentity !== undefined) {
    patch.mirrors_worry_identity = mirrorsWorryIdentity;
  }
  const { error } = await supabase
    .from("itc_commitments")
    .update(patch)
    .eq("id", commitmentId);
  if (error) throw new Error(`updateCommitmentDepth: ${error.message}`);
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
): Promise<{ row: ItcAssumption; deduped: boolean }> {
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
    return { row: duplicate, deduped: true };
  }
  const { data, error } = await supabase
    .from("itc_assumptions")
    .insert({
      map_id: mapId,
      text: text.trim(),
      sort_order: existing.length,
      attempts: 1,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`addAssumption: ${error?.message ?? "no row"}`);
  return { row: data as ItcAssumption, deduped: false };
}

/**
 * Update an assumption's text and bump attempts by one. Called from
 * saveAssumption on the edit path. Clears depth_score so the caller
 * (saveAssumption) re-scores immediately with the fresh rubric.
 */
export async function updateAssumptionText(
  id: string,
  mapId: string,
  text: string,
): Promise<ItcAssumption> {
  const trimmed = text.trim();
  if (trimmed.length < 3) throw new Error("Assumption is too short.");
  const supabase = createSupabaseServiceClient();
  const existing = await supabase
    .from("itc_assumptions")
    .select("attempts")
    .eq("id", id)
    .eq("map_id", mapId)
    .maybeSingle();
  if (existing.error) throw new Error(`updateAssumptionText lookup: ${existing.error.message}`);
  if (!existing.data) throw new Error("Assumption not on this map.");
  const { data, error } = await supabase
    .from("itc_assumptions")
    .update({
      text: trimmed,
      attempts: (existing.data.attempts ?? 0) + 1,
      depth_score: null,
      // Clear the previous rubric reason too — it's about the old text,
      // so leaving it stale would tell the coachee to sharpen something
      // that no longer describes what's on the page. The next save's
      // rubric run will repopulate against the new text.
      rubric_reason: null,
    })
    .eq("id", id)
    .eq("map_id", mapId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`updateAssumptionText: ${error?.message ?? "no row"}`);
  return data as ItcAssumption;
}

export async function updateAssumptionDepth(
  assumptionId: string,
  score: number,
  reason?: string | null,
): Promise<void> {
  if (score < 0 || score > 3 || !Number.isInteger(score)) {
    throw new Error(`updateAssumptionDepth: score must be int 0-3, got ${score}`);
  }
  const supabase = createSupabaseServiceClient();
  const patch: { depth_score: number; rubric_reason?: string | null } = {
    depth_score: score,
  };
  if (reason !== undefined) {
    patch.rubric_reason = reason?.trim() || null;
  }
  const { error } = await supabase
    .from("itc_assumptions")
    .update(patch)
    .eq("id", assumptionId);
  if (error) throw new Error(`updateAssumptionDepth: ${error.message}`);
}

export async function deleteAssumption(
  assumptionId: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_assumptions")
    .delete()
    .eq("id", assumptionId)
    .eq("map_id", mapId);
  if (error) throw new Error(`deleteAssumption: ${error.message}`);
}

export async function clearAssumptionLinks(assumptionId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_assumption_commitments")
    .delete()
    .eq("assumption_id", assumptionId);
  if (error) throw new Error(`clearAssumptionLinks: ${error.message}`);
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

/**
 * List coach-drafted assumptions for a map with their commitment
 * coverage joined in. Empty array when no drafts exist yet.
 */
export async function listAssumptionDrafts(
  mapId: string,
): Promise<ItcAssumptionDraft[]> {
  const supabase = createSupabaseServiceClient();
  const { data: drafts, error } = await supabase
    .from("itc_assumption_drafts")
    .select("id, map_id, text, created_at")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listAssumptionDrafts: ${error.message}`);
  const rows = (drafts ?? []) as Array<{
    id: string;
    map_id: string;
    text: string;
    created_at: string;
  }>;
  if (rows.length === 0) return [];
  const { data: links, error: lErr } = await supabase
    .from("itc_assumption_draft_commitments")
    .select("draft_id, commitment_id")
    .in(
      "draft_id",
      rows.map((r) => r.id),
    );
  if (lErr) throw new Error(`listAssumptionDrafts links: ${lErr.message}`);
  const byDraft = new Map<string, string[]>();
  for (const l of (links ?? []) as Array<{
    draft_id: string;
    commitment_id: string;
  }>) {
    const arr = byDraft.get(l.draft_id) ?? [];
    arr.push(l.commitment_id);
    byDraft.set(l.draft_id, arr);
  }
  return rows.map((r) => ({
    ...r,
    commitment_ids: byDraft.get(r.id) ?? [],
  }));
}

/**
 * Persist a batch of coach-drafted assumptions. Called by the
 * advance-to-assumptions pipeline after the LLM has produced its
 * cluster proposals. Any draft with zero commitment links is
 * silently dropped — a draft that underwrites nothing is useless.
 *
 * Returns the count of drafts actually persisted (after the filter).
 * Callers use this to give the coachee honest feedback — a silent
 * "0 drafts written" without UI signaling is exactly the bug pattern
 * we hit with the regenerate-drafts button.
 */
export async function saveAssumptionDrafts(
  mapId: string,
  drafts: Array<{ text: string; commitment_ids: string[] }>,
): Promise<number> {
  const clean = drafts
    .map((d) => ({
      text: d.text.trim(),
      commitment_ids: Array.from(new Set(d.commitment_ids)),
    }))
    .filter((d) => d.text.length >= 3 && d.commitment_ids.length > 0);
  if (clean.length === 0) return 0;
  const supabase = createSupabaseServiceClient();
  const { data: inserted, error } = await supabase
    .from("itc_assumption_drafts")
    .insert(clean.map((d) => ({ map_id: mapId, text: d.text })))
    .select("id");
  if (error || !inserted)
    throw new Error(`saveAssumptionDrafts insert: ${error?.message ?? "no rows"}`);
  const linkRows: Array<{ draft_id: string; commitment_id: string }> = [];
  for (let i = 0; i < clean.length; i++) {
    const draftId = (inserted[i] as { id: string }).id;
    for (const cid of clean[i].commitment_ids) {
      linkRows.push({ draft_id: draftId, commitment_id: cid });
    }
  }
  if (linkRows.length === 0) return clean.length;
  const { error: lErr } = await supabase
    .from("itc_assumption_draft_commitments")
    .insert(linkRows);
  if (lErr) throw new Error(`saveAssumptionDrafts links: ${lErr.message}`);
  return clean.length;
}

/**
 * Delete a single draft (and cascade its commitment links). Called on
 * Use-this-draft (after promoting to an itc_assumptions row) and on
 * Dismiss. Idempotent — silently no-ops if the draft is already gone.
 */
export async function deleteAssumptionDraft(
  draftId: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_assumption_drafts")
    .delete()
    .eq("id", draftId)
    .eq("map_id", mapId);
  if (error) throw new Error(`deleteAssumptionDraft: ${error.message}`);
}

export async function setAssumptionSelected(
  assumptionId: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  // Clear all selections, then set the target. One-at-a-time enforcement.
  const clear = await supabase
    .from("itc_assumptions")
    .update({ selected_for_testing: false })
    .eq("map_id", mapId);
  if (clear.error) throw new Error(`setAssumptionSelected clear: ${clear.error.message}`);
  const { error } = await supabase
    .from("itc_assumptions")
    .update({ selected_for_testing: true })
    .eq("id", assumptionId)
    .eq("map_id", mapId);
  if (error) throw new Error(`setAssumptionSelected: ${error.message}`);
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
    .not("status", "in", "(abandoned,superseded)")
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
  const assumptionSnapshot = await supabase
    .from("itc_assumptions")
    .select("text")
    .eq("id", input.assumptionId)
    .maybeSingle();
  const assumptionTextAtDesign =
    (assumptionSnapshot.data as { text: string } | null)?.text ?? null;

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
      assumption_text_at_design: assumptionTextAtDesign,
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

/**
 * Update an existing test's fields. Used by runTest when the coachee
 * edits a pre-drafted test in place before running. Bumps status back
 * to "designed" so a coachee who re-edits after running (rare edge)
 * can't skip the fresh coach review.
 */
export async function updateTest(input: {
  testId: string;
  mapId: string;
  testType: ItcTestType;
  assumptionSays: string;
  behaviorChange: string;
  dataToCollect: string;
  inOrderToFindOut: string;
  targetDate: string;
}): Promise<ItcTest> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_tests")
    .update({
      test_type: input.testType,
      assumption_says: input.assumptionSays.trim(),
      behavior_change: input.behaviorChange.trim(),
      data_to_collect: input.dataToCollect.trim(),
      in_order_to_find_out: input.inOrderToFindOut.trim(),
      target_date: input.targetDate,
      status: "designed",
    })
    .eq("id", input.testId)
    .eq("map_id", input.mapId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`updateTest: ${error?.message ?? "no row"}`);
  return data as ItcTest;
}

/**
 * Mark a test as abandoned. Called by abandonInFlightTest server
 * action when the coachee decides mid-design to pick a different
 * assumption. History is preserved (row stays in DB) but the test
 * is no longer the "active" one for gate + UI purposes.
 */
export async function markTestAbandoned(
  testId: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_tests")
    .update({ status: "abandoned" })
    .eq("id", testId)
    .eq("map_id", mapId);
  if (error) throw new Error(`markTestAbandoned: ${error.message}`);
}

/**
 * Retire a test whose paired assumption has drifted since design. The
 * coachee designs a fresh one against the current assumption text; the
 * old row stays for history under status='superseded'.
 */
export async function markTestSuperseded(
  testId: string,
  mapId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_tests")
    .update({ status: "superseded" })
    .eq("id", testId)
    .eq("map_id", mapId);
  if (error) throw new Error(`markTestSuperseded: ${error.message}`);
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
/**
 * Update an existing test result. Used by saveTestResult when the
 * coachee edits their debrief in place after saving. The coach
 * re-reviews after the update (via the excavation-loop pattern
 * shared with test-design).
 */
export async function updateTestResult(input: {
  resultId: string;
  ranOn: string;
  whatIDid: string;
  dataCollected: string;
  whatItSaysAboutAssumption: string;
  assumptionVerdict: ItcAssumptionVerdict;
  nextStep: ItcNextStep;
}): Promise<ItcTestResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_test_results")
    .update({
      ran_on: input.ranOn,
      what_i_did: input.whatIDid.trim(),
      data_collected: input.dataCollected.trim(),
      what_it_says_about_assumption: input.whatItSaysAboutAssumption.trim(),
      assumption_verdict: input.assumptionVerdict,
      next_step: input.nextStep,
    })
    .eq("id", input.resultId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`updateTestResult: ${error?.message ?? "no row"}`);
  return data as ItcTestResult;
}

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
    .update({ selected_for_testing: false })
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
    .update({ walkthrough_delivered: true, walkthrough_stale: false })
    .eq("id", mapId);
  if (error) throw new Error(`markWalkthroughDelivered: ${error.message}`);
}

/**
 * Reset walkthrough_delivered to false. Used by the client-triggered
 * regenerateWalkthrough action so the subsequent
 * deliverWalkthroughAfterAdvance call doesn't short-circuit on
 * "already delivered."
 */
export async function markWalkthroughNotDelivered(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ walkthrough_delivered: false })
    .eq("id", mapId);
  if (error) throw new Error(`markWalkthroughNotDelivered: ${error.message}`);
}

/**
 * Delete every itc_messages row matching the (map, surface, stage,
 * entry_ref) tuple. Used by regenerate flows (walkthrough, drafts,
 * prioritize recommendation) that need to clear the previous
 * coach-authored artifact before writing a fresh one — otherwise the
 * new one would render alongside the stale one.
 */
export async function deleteStageNoteMessages(input: {
  mapId: string;
  stage: ItcStage;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_messages")
    .delete()
    .eq("map_id", input.mapId)
    .eq("surface", "stage_note")
    .eq("stage_at_creation", input.stage);
  if (error) throw new Error(`deleteStageNoteMessages: ${error.message}`);
}

/**
 * Wipe the column_review message for a given stage. Called after any
 * entry add/edit/delete in that column so the next page render can
 * regenerate the review against fresh state. Silent no-op when nothing
 * exists (fresh map, or already deleted, or coach hasn't drafted yet).
 */
export async function deleteColumnReviewMessages(input: {
  mapId: string;
  stage: ItcStage;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_messages")
    .delete()
    .eq("map_id", input.mapId)
    .eq("surface", "column_review")
    .eq("stage_at_creation", input.stage);
  if (error) throw new Error(`deleteColumnReviewMessages: ${error.message}`);
}

/**
 * Does a column_review message already exist for the given stage? Used
 * by ensureColumnReviewDelivered to skip when the coach's audit has
 * already been persisted for this set state.
 */
export async function hasColumnReviewMessage(input: {
  mapId: string;
  stage: ItcStage;
}): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .select("id", { head: false })
    .eq("map_id", input.mapId)
    .eq("surface", "column_review")
    .eq("stage_at_creation", input.stage)
    .limit(1);
  if (error) throw new Error(`hasColumnReviewMessage: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Wipe every hone_diagnostic message for a map. Called on any entry
 * write anywhere on the map — the diagnostic reads the whole map
 * so any change stales it. Also called before writing a fresh
 * diagnostic in runHoneDiagnostic so re-clicking the button always
 * replaces the last audit.
 */
export async function deleteHoneDiagnosticMessages(input: {
  mapId: string;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_messages")
    .delete()
    .eq("map_id", input.mapId)
    .eq("surface", "hone_diagnostic");
  if (error) throw new Error(`deleteHoneDiagnosticMessages: ${error.message}`);
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
  opts: {
    surface?: ItcMessageSurface;
    entryRefTable?: string;
    entryRefId?: string;
  } = {},
): Promise<ItcMessage> {
  const supabase = createSupabaseServiceClient();
  const row: Record<string, unknown> = {
    map_id: mapId,
    role,
    content,
    stage_at_creation: stage,
  };
  if (opts.surface) row.surface = opts.surface;
  if (opts.entryRefTable) row.entry_ref_table = opts.entryRefTable;
  if (opts.entryRefId) row.entry_ref_id = opts.entryRefId;
  const { data, error } = await supabase
    .from("itc_messages")
    .insert(row)
    .select("*")
    .single();
  if (error || !data) throw new Error(`appendMessage: ${error?.message ?? "no row"}`);
  return data as ItcMessage;
}

/**
 * Messages anchored to a specific entry — the thread beneath a
 * behavior, worry, commitment, assumption, etc. Returns in
 * created_at order.
 */
export async function listThreadMessages(
  mapId: string,
  entryRefTable: string,
  entryRefId: string,
): Promise<ItcMessage[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", mapId)
    .eq("entry_ref_table", entryRefTable)
    .eq("entry_ref_id", entryRefId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listThreadMessages: ${error.message}`);
  return (data ?? []) as ItcMessage[];
}

/**
 * Messages on a specific surface for the current stage. Used to
 * fetch just the stage-note messages, or just dock messages, etc.
 */
export async function listMessagesForSurface(
  mapId: string,
  stage: ItcStage,
  surface: ItcMessageSurface,
): Promise<ItcMessage[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", mapId)
    .eq("stage_at_creation", stage)
    .eq("surface", surface)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listMessagesForSurface: ${error.message}`);
  return (data ?? []) as ItcMessage[];
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
      if (selectedCount < 3) {
        throw new Error(
          `Add at least 3 doings/not-doings before moving to worries (currently ${selectedCount}). 3 to 5 is what shows the pattern.`,
        );
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
    if (to === "review" || to === "immune_system") {
      const [assumptions, commitments, links] = await Promise.all([
        listAssumptions(mapId),
        listCommitments(mapId),
        listAssumptionLinks(mapId),
      ]);
      if (assumptions.length === 0) {
        throw new Error(
          `Add at least one Big Assumption before advancing to ${to}.`,
        );
      }
      const coveredCommitments = new Set(links.map((l) => l.commitment_id));
      const uncovered = commitments.filter((c) => !coveredCommitments.has(c.id));
      if (uncovered.length > 0) {
        throw new Error(
          `Every commitment must be covered by an assumption before advancing to ${to}. Uncovered: ${uncovered.length}.`,
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
