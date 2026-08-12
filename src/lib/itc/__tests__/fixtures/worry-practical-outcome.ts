/**
 * Scenario: coach asks the worry-box elicitation. Coachee offers a
 * practical outcome ("she'd get more upset") — not a felt fear. Coach
 * must recognize this as practical, NOT propose_worry yet, and probe
 * with the "worst part of that for you" follow-up.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const worryPracticalOutcome: CoachTurnInput = baseCoachInput({
  stage: "worries",
  worries: [],
  history: [
    {
      role: "assistant",
      content:
        "Now the worry box. For each of these, we're going to name the fear underneath, what part of you these behaviors are actually protecting. Starting with #1, 'I guide people down a path that feels a little forced': if you stopped doing that, what are you afraid would happen?",
    },
  ],
  userMessage: "They'd just leave the call and go do it themselves. Waste of time for both of us.",
});
