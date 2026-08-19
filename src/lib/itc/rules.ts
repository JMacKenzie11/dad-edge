import { GOAL_STEM } from "./stage";

/**
 * Depth-gate rule: a worry / commitment / assumption passes when its
 * rubric score is 3/3, OR when the score is 2/3 and the coachee has
 * made at least two attempts at this entry. The two-attempts-at-2
 * escape hatch prevents locking a man out when a rubric edge case
 * disagrees with what's obviously a real fear / vow / belief.
 */
export function worryPassesDepth(
  depthScore: number | null,
  attempts: number,
): boolean {
  if (depthScore === null) return false;
  if (depthScore >= 3) return true;
  if (depthScore === 2 && attempts >= 2) return true;
  return false;
}

/**
 * Detect goal-framing prefixes the user might type INSTEAD of the
 * required `GOAL_STEM`. Prepending the stem to any of these produces
 * a mashup ("I'm committed to getting better at I want to get better
 * at X"). saveGoal rejects with a clear error when one of these
 * fires so the user re-phrases with the stem intact.
 */
export function hasCompetingGoalFraming(text: string): boolean {
  // GOAL_STEM itself is fine — filter that out first so a properly
  // stemmed goal doesn't accidentally match "I'm committed" opener.
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith(GOAL_STEM.toLowerCase())) return false;
  const openers = [
    /^i\s*(?:'|\u2019)?m\s+committed/i, // "I'm committed" without the full stem
    /^i\s+want\s+to\b/i,
    /^i\s*(?:'|\u2019)?d\s+like\s+to\b/i,
    /^i\s+would\s+like\s+to\b/i,
    /^my\s+goal\b/i,
    /^my\s+commitment\b/i,
    /^i\s+need\s+to\b/i,
    /^i\s+will\b/i,
    /^i\s+plan\s+to\b/i,
    /^help\s+me\b/i,
  ];
  return openers.some((re) => re.test(text.trim()));
}
