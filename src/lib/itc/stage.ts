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
  commitments: "Commitments",
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
 */
export function canTransitionTo(from: ItcStage, to: ItcStage): boolean {
  const fromIdx = stageIndex(from);
  const toIdx = stageIndex(to);
  if (toIdx <= fromIdx) return true;
  return toIdx === fromIdx + 1;
}

export const GOAL_STEM = "I'm committed to getting better at";

/**
 * Server-side goal-stem enforcement. Trims and lower-cases the leading
 * fragment for comparison but leaves the stored text as the user wrote it.
 */
export function hasGoalStem(text: string): boolean {
  return text.trim().toLowerCase().startsWith(GOAL_STEM.toLowerCase());
}
