/**
 * Column 1 (improvement goal) criteria.
 *
 * Currently one check: bundled_goal. A goal that packs two distinct
 * improvements ("getting better at coaching my team AND building my
 * business") produces muddy behaviors and untestable tests because
 * each half implies a different behavior set. Split it, run one for
 * this map, save the other for a later map.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";
import type { Finding } from "./types";

const BundledGoalSchema = z.object({
  bundled: z.boolean(),
  first_half: z.string().optional(),
  second_half: z.string().optional(),
});

const BUNDLED_GOAL_SYSTEM = `
You are a strict classifier for Column 1 improvement goals in an Immunity to Change map. A "bundled" goal packs two distinct improvements into one sentence, pointed at different objects or audiences, joined by "and". Bundled goals produce muddy behaviors and untestable tests because each half implies a different behavior set.

Not bundled: one improvement, even if it uses "and" for pacing. "getting better at listening and staying present with my wife" is one improvement (both verbs point at the same relationship). "getting better at coaching my team and building my business" is bundled (two audiences, two improvement areas).

Return bundled=true only when the two halves clearly point at DIFFERENT objects/audiences/domains. When in doubt, false.

If bundled=true, split the goal into first_half and second_half. Each half should stand on its own as a plausible Column 1 goal (may need a leading "getting better at" or similar to read naturally, but keep the coachee's own words).
`.trim();

/**
 * Heuristic: goal text mentions two distinct object nouns joined by
 * "and". Cheap tripwire that prevents an LLM verify call on every
 * single-improvement goal. False positives here are corrected by the
 * verify call; false negatives (a bundled goal that doesn't match the
 * heuristic) fall through to no-finding, which is the safe default.
 */
function goalLooksBundled(goalText: string): boolean {
  const trimmed = goalText.trim();
  if (trimmed.length === 0) return false;
  if (!/\band\b/i.test(trimmed)) return false;
  const verbCount = (
    trimmed.match(/\b(?:ing|listening|speaking|coaching|building|running|leading|making)\b/gi) ??
    []
  ).length;
  if (verbCount >= 2) return true;
  const atAndMatch = trimmed.match(
    /\bat\s+[\w\s]{3,40}\s+and\s+[\w\s]{3,40}\b/i,
  );
  if (atAndMatch) return true;
  return false;
}

export async function checkBundledGoal(input: {
  mapId: string;
  goalText: string;
}): Promise<Finding[]> {
  if (!input.goalText || input.goalText.trim().length === 0) return [];
  if (!goalLooksBundled(input.goalText)) return [];
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: BundledGoalSchema,
      system: BUNDLED_GOAL_SYSTEM,
      prompt: `Improvement goal: ${input.goalText}`,
      maxOutputTokens: 400,
      temperature: 0.1,
    });
    if (!object.bundled) return [];
    const fix =
      object.first_half && object.second_half
        ? `Pick one for this map. First half: "${object.first_half.trim()}". Second half: "${object.second_half.trim()}". Run the other in a later map.`
        : undefined;
    return [
      {
        entryRef: { table: "goal", id: input.mapId },
        issueType: "bundled_goal",
        severity: "critical",
        actualText: input.goalText,
        detail:
          "Goal packs two distinct improvements pointed at different objects. Each half implies a different behavior set, so the whole map ends up muddy.",
        suggestedFix: fix,
      },
    ];
  } catch (err) {
    console.warn(
      "[itc criteria] checkBundledGoal failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
