/**
 * Fixture builders for coach behavior tests. Each helper returns a shape
 * matching what runItcCoachTurn expects — no DB round-trip required.
 * Callers override just the fields they care about per scenario.
 */

import type { PillarCode } from "@/lib/pillars";
import type { ItcStage } from "@/lib/itc/stage";

export type FakeBehavior = {
  id: string;
  text: string;
  selected: boolean;
};

export type FakeWorry = {
  behavior_id: string;
  text: string;
  depth_score: number | null;
};

export type FakeCommitment = {
  id: string;
  worry_id: string;
  text: string;
};

export type FakeAssumption = {
  id: string;
  text: string;
  depth_score: number | null;
  selected_for_testing: boolean;
  coach_recommended: boolean;
  linked_commitment_ids: string[];
};

export type FakeChatTurn = { role: "user" | "assistant"; content: string };

export type CoachTurnInput = {
  pillar: PillarCode;
  stage: ItcStage;
  improvementGoal: string | null;
  behaviors: FakeBehavior[];
  worries: FakeWorry[];
  commitments: FakeCommitment[];
  assumptions: FakeAssumption[];
  revealDelivered: boolean;
  walkthroughDelivered: boolean;
  tests: never[];
  testResults: never[];
  mapStatus: string;
  history: FakeChatTurn[];
  userMessage: string;
  recentActionFeedback: string[];
};

/**
 * Base fixture — plausible in-progress map with goal + 5 behaviors + a
 * couple of locked worries. Callers spread + override for a specific
 * scenario, so no defaults have to be memorized.
 */
export function baseCoachInput(
  overrides: Partial<CoachTurnInput> = {},
): CoachTurnInput {
  return {
    pillar: "A",
    stage: "worries",
    improvementGoal:
      "I'm committed to getting better at leading from grounded service across everything I put out, even when I feel financial pressure.",
    behaviors: [
      { id: "b1", text: "I guide people down a path that feels a little forced", selected: true },
      { id: "b2", text: "I script out specific questions in advance to steer someone toward the next step", selected: true },
      { id: "b3", text: "I use AI to write my messages instead of writing in my own voice", selected: true },
      { id: "b4", text: "I over-explain the program and answer questions they didn't ask", selected: true },
      { id: "b5", text: "I rush through the call, focused on getting them to the next step, instead of staying present with what they're saying", selected: true },
    ],
    worries: [],
    commitments: [],
    assumptions: [],
    revealDelivered: false,
    walkthroughDelivered: false,
    tests: [],
    testResults: [],
    mapStatus: "in_progress",
    history: [],
    userMessage: "",
    recentActionFeedback: [],
    ...overrides,
  };
}
