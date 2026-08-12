/**
 * Scenario: coachee offers an inner state ("I feel anxious") when the
 * coach asked for a behavior. Coach must NOT accept and should push
 * with a specific converting question ("when you're anxious, what do
 * you actually do or not do?"). Coach should NOT fire propose_behavior
 * on an inner state.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const behaviorInnerState: CoachTurnInput = baseCoachInput({
  stage: "behaviors",
  behaviors: [],
  worries: [],
  history: [
    {
      role: "assistant",
      content:
        "Column 2 is what you actually do (or fail to do) that works against 'being present and calm when my wife is upset.' It's not about intent — it's the specific stuff that happens in the moment. First one that comes to mind?",
    },
  ],
  userMessage: "I feel anxious and shut down.",
});
