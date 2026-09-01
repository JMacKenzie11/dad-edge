/**
 * Column 2 (behaviors) criteria.
 *
 * One check for now:
 *  - depth_shortfall_behavior: behavior hasn't reached observable /
 *    goal-connected / first-person-action depth (reads stored rubric
 *    score set at save time by scoreBehaviorDepth).
 *
 * Only SELECTED behaviors are checked. Suggested-but-not-selected
 * behaviors have depth scores too but they aren't part of the map,
 * so they don't belong in the honing waterfall.
 */

import type { ItcBehavior } from "../maps";
import { ADVICE } from "./advice";
import { DEPTH_THRESHOLD, type Finding } from "./types";

export async function checkBehaviorDepth(input: {
  behaviors: ItcBehavior[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const behavior of input.behaviors) {
    if (!behavior.selected) continue;
    if (behavior.depth_score == null) continue;
    if (behavior.depth_score >= DEPTH_THRESHOLD) continue;
    const detail = behavior.rubric_reason
      ? `${ADVICE.depth_shortfall_behavior} Rubric reason: ${behavior.rubric_reason}`
      : ADVICE.depth_shortfall_behavior;
    findings.push({
      entryRef: { table: "behaviors", id: behavior.id },
      issueType: "depth_shortfall_behavior",
      severity: "critical",
      actualText: behavior.text,
      detail,
    });
  }
  return findings;
}
