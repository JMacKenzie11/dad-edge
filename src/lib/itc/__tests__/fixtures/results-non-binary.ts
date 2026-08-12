/**
 * Scenario: coachee has run their test and returned with observations
 * framed in pass/fail terms — "the assumption was right, she got
 * upset." Coach must reject the binary framing and probe for what
 * actually happened, what surprised him, and where the gap between
 * prediction and reality lives. Should NOT accept "assumption
 * confirmed" without unpacking.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const resultsNonBinary: CoachTurnInput = baseCoachInput({
  stage: "results",
  revealDelivered: true,
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
        "Ready when you are — did you get to run the test? What did you notice?",
    },
  ],
  userMessage:
    "Yeah, I ran it. Assumption was right — I stayed present, she pushed back on something I said, and I felt terrible. So basically confirmed.",
});
