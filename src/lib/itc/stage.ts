/**
 * Stage machine for ITC maps. Ordered list defines the canonical progression.
 * Enforced both here (server actions) and by API-layer checks; the DB stores
 * the current stage but does not itself enforce transitions.
 */

export const ITC_STAGES = [
  "goal",
  "behaviors",
  "worries",
  "commitments",
  "assumptions",
  "review",
  "immune_system",
  "prioritize",
  "test_design",
  "test_running",
  "results",
  "done",
] as const;

export type ItcStage = (typeof ITC_STAGES)[number];

export const STAGE_LABELS: Record<ItcStage, string> = {
  goal: "Goal",
  behaviors: "Behaviors",
  worries: "Worries",
  commitments: "Competing Commitments",
  assumptions: "Big Assumptions",
  review: "Review",
  immune_system: "Immune System",
  prioritize: "Prioritize",
  test_design: "Test",
  test_running: "Running",
  results: "Results",
  done: "Done",
};

export function stageIndex(stage: ItcStage): number {
  return ITC_STAGES.indexOf(stage);
}

export function nextStage(stage: ItcStage): ItcStage {
  const i = stageIndex(stage);
  return ITC_STAGES[Math.min(i + 1, ITC_STAGES.length - 1)];
}

/**
 * Guardrail — refuses forward jumps that skip a stage. Backward transitions
 * (e.g., returning to Goal to hone) are always allowed.
 *
 * Explicit allow-list of forward skips: assumptions → immune_system.
 * The review stage was a mid-flow checkpoint that added a turn without
 * moving the map forward; on assumption lock the coach now goes straight
 * into the immune-system walkthrough so the coachee sees his map
 * explained top-down as soon as it's complete. The review stage still
 * exists as a name so backward transitions and legacy sessions don't
 * break.
 */
export function canTransitionTo(from: ItcStage, to: ItcStage): boolean {
  const fromIdx = stageIndex(from);
  const toIdx = stageIndex(to);
  if (toIdx <= fromIdx) return true;
  if (toIdx === fromIdx + 1) return true;
  if (from === "assumptions" && to === "immune_system") return true;
  return false;
}

export const GOAL_STEM = "I'm committed to getting better at";
export const WORRY_STEM = "I worry that";
export const COMMITMENT_STEM = "I'm also committed to";
export const ASSUMPTION_STEM = "I assume that";

/**
 * Prepend a stem if the text doesn't already start with it. Tolerates
 * smart apostrophes so a coach reply using U+2019 still normalizes cleanly.
 */
function normalizedStartsWith(text: string, stem: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/[\u2018\u2019\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .toLowerCase();
  return norm(text).startsWith(norm(stem));
}

export function ensureStem(text: string, stem: string): string {
  if (normalizedStartsWith(text, stem)) return text.trim();
  // Lowercase the first char of the incoming text so it flows into the stem.
  const rest = text.trim().replace(/^./, (c) => c.toLowerCase());
  return `${stem} ${rest}`;
}

/**
 * Server-side goal-stem enforcement. Trims and lower-cases the leading
 * fragment for comparison and normalizes smart apostrophes/quotes so a
 * coach reply that used U+2019 for "I'm" still passes. Stored text stays
 * as the caller wrote it (up to them to pass a normalized string).
 */
export function hasGoalStem(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase();
  return normalized.startsWith(GOAL_STEM.toLowerCase());
}

/**
 * Column 5 Big-Assumption stem check. The "I assume that" prefix makes
 * the epistemic status explicit: this is a belief he holds and can
 * test, not a fact about reality. That framing is the whole job of
 * the stem, and it is why the stem stays even though the SHAPE that
 * used to follow it does not.
 *
 * This comment used to say the canonical form is "I assume that if
 * I …, then …". It isn't. Kegan & Lahey Vol 1 p 19 answer their own
 * quiz of twelve assumptions: only 6, 7 and 10 are not testable.
 * Items 1, 2 and 9 carry no "if" and no "then" and are fine, with
 * worked tests in Appendix D. Vol 1 p 4 asks only that AT LEAST ONE
 * assumption on a map be in if-then form. See
 * src/lib/itc/__tests__/assumption-shape.test.ts.
 *
 * Unlike goals, where saveGoal rejects competing framing,
 * saveAssumption auto-prepends the stem via ensureStem, so a man can
 * type the belief with or without it and land in the same place. The
 * add form seeds the box with it so he can see the sentence he is
 * writing rather than meeting it after the save.
 */
export function hasAssumptionStem(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase();
  return normalized.startsWith(ASSUMPTION_STEM.toLowerCase());
}

/**
 * Collapse the improvement-goal stem to exactly one, then guarantee it.
 *
 * hasGoalStem only ever answered "does this text START with the
 * stem", and saveGoal used it to decide whether to prepend. That
 * stops the SERVER adding a second stem; it never noticed a second
 * one already in the text. The goal box pre-fills with the stem
 * (goal-row.tsx), so a man who typed or pasted the whole sentence
 * after it produced "I'm committed to getting better at I'm committed
 * to getting better at trusting myself…", hasGoalStem said true, and
 * it saved verbatim. Seen on a live map 2026-09-03.
 *
 * Strips repeats and the common variants ("I am committed to", a
 * curly apostrophe) rather than rejecting, because the text is
 * otherwise exactly what he meant. Same approach as
 * ensureCommitmentStem below.
 */
export function ensureGoalStem(text: string): string {
  // Trailing whitespace optional: the bare stem with nothing after it
  // has to peel too, or it falls through and gets a second one
  // prepended.
  const stemPattern = /^i\s*(?:'|\u2019|\u02BC)?\s*(?:m|am)\s+committed\s+to\s+getting\s+better\s+at\s*/i;
  let rest = text.trim().replace(/[\u2018\u2019\u02BC]/g, "'");
  // Peel every leading stem, however many he typed.
  let peeled = 0;
  while (stemPattern.test(rest) && peeled < 10) {
    rest = rest.replace(stemPattern, "").trim();
    peeled += 1;
  }
  if (rest.length === 0) return text.trim();
  return `${GOAL_STEM} ${rest.replace(/^./, (c) => c.toLowerCase())}`;
}

/**
 * Normalize commitment text to the canonical "I'm also committed to
 * ..." form. The "also" is load-bearing — it names this as the
 * SECOND commitment sitting next to the Column 1 improvement goal, so
 * the coexistence with the primary commitment is unmissable.
 *
 * Strips common prefix variants the coachee might type ("I am
 * committed to", "I'm committed to" without the "also", "I am also
 * committed to") so the final text always leads with the exact
 * canonical stem. Called from saveCommitment; the LLM-side
 * assembleCommitment already produces canonical form so drafter
 * output doesn't need this normalization.
 */
export function ensureCommitmentStem(text: string): string {
  const stripped = text
    .trim()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/^i'?m\s+also\s+committed\s+to\s+/i, "")
    .replace(/^i'?m\s+committed\s+to\s+/i, "")
    .replace(/^i\s+am\s+also\s+committed\s+to\s+/i, "")
    .replace(/^i\s+am\s+committed\s+to\s+/i, "")
    .trim();
  if (stripped.length === 0) return text.trim();
  const rest = stripped.replace(/^./, (c) => c.toLowerCase());
  return `${COMMITMENT_STEM} ${rest}`;
}
