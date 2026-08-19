/**
 * Composer for the ITC coach system prompt.
 *
 * The old monolith at src/lib/itc/prompts.ts loaded every stage's rules on
 * every turn (~13K tokens). Most of that content is irrelevant to whichever
 * stage the coachee is currently in. This composer loads only what the
 * current turn needs:
 *
 * - preamble (static globals, voice rules, structured-output contract)
 * - current-stage rules
 * - next-stage rules (so the coach can write the transition intro correctly)
 * - dynamic context block (map state, recent server feedback)
 *
 * Prompt-cache friendly: the preamble is the same string across turns so
 * the provider can hit the cache. Stage modules also stay identical between
 * turns of the same stage.
 */

import { nextStage, type ItcStage } from "../stage";
import { PREAMBLE } from "./preamble";
import { GOAL_STAGE } from "./stages/goal";
import { BEHAVIORS_STAGE } from "./stages/behaviors";
import { WORRIES_STAGE } from "./stages/worries";
import { COMMITMENTS_STAGE } from "./stages/commitments";
import { ASSUMPTIONS_STAGE } from "./stages/assumptions";
import { REVIEW_STAGE } from "./stages/review";
import { IMMUNE_SYSTEM_STAGE } from "./stages/immune-system";
import { PRIORITIZE_STAGE } from "./stages/prioritize";
import { TEST_DESIGN_STAGE } from "./stages/test-design";
import { TEST_RUNNING_STAGE } from "./stages/test-running";
import { RESULTS_STAGE } from "./stages/results";
import { DONE_STAGE } from "./stages/done";

const STAGE_PROMPT: Record<ItcStage, string> = {
  goal: GOAL_STAGE,
  behaviors: BEHAVIORS_STAGE,
  worries: WORRIES_STAGE,
  commitments: COMMITMENTS_STAGE,
  assumptions: ASSUMPTIONS_STAGE,
  review: REVIEW_STAGE,
  immune_system: IMMUNE_SYSTEM_STAGE,
  prioritize: PRIORITIZE_STAGE,
  test_design: TEST_DESIGN_STAGE,
  test_running: TEST_RUNNING_STAGE,
  results: RESULTS_STAGE,
  done: DONE_STAGE,
};

type BuildInput = {
  pillarLabel: string;
  pillarDomain: string;
  stage: ItcStage;
  improvementGoal: string | null;
  behaviors: { id: string; text: string; selected: boolean }[];
  worries: {
    behavior_id: string;
    text: string;
    depth_score: number | null;
  }[];
  commitments: {
    id: string;
    worry_id: string;
    text: string;
    depth_score: number | null;
  }[];
  assumptions: {
    id: string;
    text: string;
    depth_score: number | null;
    selected_for_testing: boolean;
    linked_commitment_ids: string[];
  }[];
  walkthroughDelivered: boolean;
  tests: {
    id: string;
    assumption_id: string;
    test_type: string;
    assumption_says: string | null;
    behavior_change: string | null;
    data_to_collect: string | null;
    in_order_to_find_out: string | null;
    target_date: string | null;
    status: string;
  }[];
  testResults: {
    test_id: string;
    ran_on: string | null;
    what_i_did: string | null;
    data_collected: string | null;
    what_it_says_about_assumption: string | null;
    assumption_verdict: string | null;
    next_step: string | null;
  }[];
  mapStatus: string;
  recentActionFeedback: string[];
};

/**
 * The composed coach system prompt split into a stable static prefix
 * and a per-turn dynamic tail. Callers concat them for the legacy
 * single-string system path, OR pass them as two SystemModelMessage
 * entries with cache_control on the static one for prompt caching.
 */
export type BuiltCoachSystem = {
  /** Preamble + current stage rules + next stage transition rules. Stable
   * per (stage, prompt-version). Prime cache candidate. */
  static: string;
  /** Live map state, today's date, recent action feedback. Changes
   * every turn. Never cache. */
  dynamic: string;
};

/**
 * Split variant. Prefer this in call sites — the legacy string variant
 * below is kept for callers that don't need caching (rubrics, etc.).
 */
export function buildItcCoachSystemSplit(input: BuildInput): BuiltCoachSystem {
  const { static: staticPart, dynamic } = buildParts(input);
  return { static: staticPart, dynamic };
}

export function buildItcCoachSystem(input: BuildInput): string {
  const { static: staticPart, dynamic } = buildParts(input);
  return `${staticPart}\n\n${dynamic}`;
}

function buildParts(input: BuildInput): BuiltCoachSystem {
  const worriesByBehavior = new Map(
    input.worries.map((w) => [w.behavior_id, w]),
  );

  const behaviorList = input.behaviors.length
    ? input.behaviors
        .map(
          (b, i) =>
            `  ${i + 1}. ${b.text}${b.selected ? "" : "  [legacy-parked — off-map]"}`,
        )
        .join("\n")
    : "  (none yet)";

  const selectedBehaviors = input.behaviors.filter((b) => b.selected);
  const selectedCount = selectedBehaviors.length;

  const worryList = selectedBehaviors.length
    ? selectedBehaviors
        .map((b, i) => {
          const w = worriesByBehavior.get(b.id);
          const status = w
            ? `[depth ${w.depth_score ?? "?"}/3] "${w.text}"`
            : "[not yet]";
          return `  ${i + 1}. ${b.text} → ${status}`;
        })
        .join("\n")
    : "  (need selected behaviors first)";

  const feedbackBlock = input.recentActionFeedback.length
    ? `\n- Recent server feedback on your actions (respond to this, do not repeat the same proposal):\n${input.recentActionFeedback.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`
    : "";

  const worryIndexList = input.worries.length
    ? input.worries.map((w, i) => `  ${i + 1}. "${w.text}"`).join("\n")
    : "  (none yet)";

  const commitmentList = input.commitments.length
    ? input.commitments
        .map(
          (c, i) =>
            `  ${i + 1}. [depth ${c.depth_score ?? "?"}/3] "${c.text}"`,
        )
        .join("\n")
    : "  (none yet)";

  const assumptionList = input.assumptions.length
    ? input.assumptions
        .map((a, i) => {
          const flags = [
            a.selected_for_testing ? "SELECTED" : null,
            a.depth_score !== null ? `depth ${a.depth_score}/3` : null,
          ]
            .filter(Boolean)
            .join(", ");
          return `  ${i + 1}. "${a.text}"${flags ? ` [${flags}]` : ""}`;
        })
        .join("\n")
    : "  (none yet)";

  const resultsByTest = new Map(input.testResults.map((r) => [r.test_id, r]));
  const testsList = input.tests.length
    ? input.tests
        .map((t, i) => {
          const r = resultsByTest.get(t.id);
          const verdict = r?.assumption_verdict ?? null;
          const parts = [
            `  ${i + 1}. [${t.status}${verdict ? `, verdict: ${verdict}` : ""}] type=${t.test_type}`,
            `     assumption_says: ${t.assumption_says ?? "(blank)"}`,
            `     test_move: ${t.behavior_change ?? "(blank)"}`,
            `     data_to_collect: ${t.data_to_collect ?? "(blank)"}`,
            `     in_order_to_find_out: ${t.in_order_to_find_out ?? "(blank)"}`,
            `     target_date: ${t.target_date ?? "(none)"}`,
          ];
          if (r) {
            parts.push(
              `     RESULTS ran_on=${r.ran_on ?? "(unknown)"} next_step=${r.next_step ?? "(unset)"}`,
              `       what_i_did: ${r.what_i_did ?? "(blank)"}`,
              `       data_collected: ${r.data_collected ?? "(blank)"}`,
              `       what_it_says_about_assumption: ${r.what_it_says_about_assumption ?? "(blank)"}`,
            );
          }
          return parts.join("\n");
        })
        .join("\n")
    : "  (none yet)";

  // Today's date, injected fresh each turn so the model can pick real
  // future dates for target_date fields. The LLM's training cutoff
  // makes "today" a hallucination guess — observed a test with
  // target_date=2025-06-13 (14 months in the past). Also compute the
  // one-week horizon that tests must fall within.
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const oneWeekOut = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const oneWeekISO = oneWeekOut.toISOString().slice(0, 10);

  const contextBlock = `
Current context
- Today's date: ${todayISO}. Any target_date you propose MUST be on or after this date; picking a past date is a bug (the LLM has no idea what today is unless you look at this line).
- One-week horizon (test target_date must fall on or before this): ${oneWeekISO}. Tests are timed so results land before the next mastermind call — 7 days is the outer bound, sooner is fine.
- BRAVEMAN pillar the coachee chose: ${input.pillarLabel} — ${input.pillarDomain}. Every goal, behavior, worry, commitment, and assumption on this map MUST belong to this specific domain. If he adds an entry outside the domain (e.g. a fitness behavior on Bond, or a work behavior on Vitality), that's a Case-1 mismatch — push back plainly and ask what he'd actually want to work on inside ${input.pillarLabel}.
- Current stage: ${input.stage}.
- Map status: ${input.mapStatus}.
- Immune-system walkthrough delivered: ${input.walkthroughDelivered ? "yes" : "no"}.
- Improvement goal on the map: ${input.improvementGoal ?? "(not yet set)"}.
- Behaviors on the map so far (${selectedCount} on the map${input.behaviors.length - selectedCount > 0 ? `, ${input.behaviors.length - selectedCount} legacy-parked from an older flow — treat as off-map` : ""}):
${behaviorList}
- Worry-box pairings (SELECTED behaviors only — use these 1-based indices for propose_worry.behavior_index):
${worryList}
- Worries in order (use these 1-based indices for propose_commitment.worry_index):
${worryIndexList}
- Commitments (use these 1-based indices for propose_assumption.commitment_indices):
${commitmentList}
- Assumptions (use these 1-based indices for prioritization actions):
${assumptionList}
- Tests on this map (most recent last):
${testsList}${feedbackBlock}
`.trim();

  const currentStagePrompt = STAGE_PROMPT[input.stage];
  const upcoming = nextStage(input.stage);
  const nextStagePrompt =
    upcoming !== input.stage ? STAGE_PROMPT[upcoming] : null;

  // Include the next stage's rules only when they differ from the current
  // stage's. This is what lets the coach write a competent transition intro
  // in the same reply that carries advance_stage (or the same reply where
  // the server auto-advances).
  const stageBlock = nextStagePrompt
    ? `${currentStagePrompt}\n\n===== NEXT STAGE (${upcoming}) — for transition intro only =====\n${nextStagePrompt}`
    : currentStagePrompt;

  return {
    static: `${PREAMBLE}\n\n${stageBlock}`,
    dynamic: contextBlock,
  };
}
