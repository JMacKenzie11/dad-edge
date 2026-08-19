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
 * Column 5 Big-Assumption stem check. ITC's canonical assumption form
 * is "I assume that if I …, then …" — the "I assume that" prefix makes
 * the epistemic status explicit (this is a testable belief, not a fact
 * about reality). Unlike goals, where saveGoal rejects competing
 * framing, saveAssumption auto-prepends the stem via ensureStem so the
 * user can type either "If I …" or "I assume that if I …" and land in
 * the same place.
 */
export function hasAssumptionStem(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase();
  return normalized.startsWith(ASSUMPTION_STEM.toLowerCase());
}
