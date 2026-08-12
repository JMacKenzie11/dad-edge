/**
 * Scenario: 4 behaviors already on the map. Coachee offers a 5th that
 * overlaps meaningfully with an existing one (both are "shutdown / go
 * silent" moves in slightly different frames). Coach should name the
 * overlap and either leave the existing one or fire replace_behavior
 * for a sharper phrasing — NOT emit propose_behavior for a duplicate.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const behaviorConsolidation: CoachTurnInput = baseCoachInput({
  stage: "behaviors",
  behaviors: [
    { id: "b1", text: "I go on the offense and start pointing out her flaws", selected: true },
    { id: "b2", text: "I shut down and go silent instead of responding", selected: true },
    { id: "b3", text: "I leave the room or the house to avoid the conversation", selected: true },
    { id: "b4", text: "I say 'fine, whatever' just to end it, without meaning it", selected: true },
  ],
  worries: [],
  history: [
    {
      role: "assistant",
      content:
        "That's four. Anything else you notice, when the pressure's on?",
    },
  ],
  userMessage:
    "I also stop making eye contact and just look at my phone or the wall while she's talking.",
});
