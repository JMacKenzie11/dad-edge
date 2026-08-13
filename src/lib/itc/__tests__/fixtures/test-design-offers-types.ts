/**
 * Scenario: coachee has just picked which assumption to test. Coach
 * is entering test_design stage. Assumption involves an upset spouse
 * (highest-stakes context). Coach MUST offer 2-3 test type options
 * before drafting fields. MUST NOT default to a behavioral in-the-
 * moment test with the wife as the first test.
 *
 * Regression guard: earlier bug where coach jumped straight to
 * behavioral in-the-moment as the only option.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const testDesignOffersTypes: CoachTurnInput = baseCoachInput({
  stage: "test_design",
  walkthroughDelivered: true,
  worries: [
    { behavior_id: "b1", text: "I worry that if I stop pointing out her flaws, I'll be the guy who let her down", depth_score: 3 },
    { behavior_id: "b2", text: "I worry that if I stop going silent, I'll say something that makes me the husband who hurt her", depth_score: 3 },
    { behavior_id: "b3", text: "I worry that if I stop leaving the room, I'll be the one proved the problem", depth_score: 3 },
    { behavior_id: "b4", text: "I worry that if I stop agreeing to end it, she'll see the strong version of me is a costume", depth_score: 3 },
  ],
  commitments: [
    { id: "c1", worry_id: "w1", text: "I'm also committed to keeping her flaws visible so mine aren't the only ones on the table" },
    { id: "c2", worry_id: "w2", text: "I'm also committed to staying closed off so I can't say the thing that hurts her" },
    { id: "c3", worry_id: "w3", text: "I'm also committed to leaving the room before she can prove I'm the one who screwed up" },
    { id: "c4", worry_id: "w4", text: "I'm also committed to agreeing before she can test whether I actually hold my own" },
  ],
  assumptions: [
    {
      id: "a1",
      text: "I assume that if I let her push back on me, I'll be exposed as weak",
      depth_score: 3,
      selected_for_testing: true,
      coach_recommended: true,
      linked_commitment_ids: ["c1", "c2", "c3", "c4"],
    },
  ],
  history: [
    {
      role: "assistant",
      content:
        "I'd start with that one — most central to the system, most consequential to your goal, cleanly testable. Sound right?",
    },
  ],
  userMessage: "Yes, let's test that one.",
});
