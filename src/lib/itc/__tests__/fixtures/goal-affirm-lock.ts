/**
 * Scenario: coach has proposed a goal on the prior turn. Coachee affirms
 * with a clear "lock it in." Coach must emit propose_goal (if not already)
 * AND advance_stage to behaviors in the same turn. Reply must be the
 * first message of the behaviors stage — intro + elicitation.
 *
 * Regression guard: earlier bug where the coach said "Locked" without
 * firing advance_stage, leaving the user stuck on the goal screen.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const goalAffirmLock: CoachTurnInput = baseCoachInput({
  stage: "goal",
  improvementGoal: null,
  behaviors: [],
  worries: [],
  history: [
    {
      role: "assistant",
      content:
        "Alright. You've picked Amplify as the pillar. Before we go anywhere else — the map begins with one goal that starts \"I'm committed to getting better at...\". Do you already have that goal, or want help getting to it?",
    },
    {
      role: "user",
      content:
        "I have one: I want to get better at being present and calm when my wife is upset.",
    },
    {
      role: "assistant",
      content:
        "It's specific, it's yours to work on, and it names a real reaction — that's what a goal for this needs. How's this: \"I'm committed to getting better at being present and calm when my wife is upset.\" Lock it in?",
    },
  ],
  userMessage: "Yes, lock it in.",
});
