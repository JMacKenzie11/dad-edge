/**
 * Scenario: coachee has just advanced into the assumptions stage. Four
 * commitments are on the map. Coach must NOT lead with a draft — the
 * ITC principle is that the coachee names the assumption when he can,
 * and only if he asks for help does the coach draft. Same pattern as
 * Column 1 (goal).
 *
 * Regression guard: earlier bug where coach unilaterally produced a
 * long identity-level Big Assumption draft on stage entry without
 * asking whether the coachee wanted help.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const assumptionsAsksFirst: CoachTurnInput = baseCoachInput({
  stage: "assumptions",
  revealDelivered: true,
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
  history: [
    {
      role: "assistant",
      content:
        "Locked. Column 1 is the gas — you want to be calm and present when she's upset. Column 4 is the brake — the vows a part of you made to make sure the fears in column 3 never come true. Column 2 behaviors are how the brake gets applied every time. The brake wins because part of you built it and needs it. This has been protecting you, probably for a long time, and it works. That's the problem. What's it like to see that?",
    },
    { role: "user", content: "That's a lot. It makes sense though." },
  ],
  userMessage: "OK, what's next?",
});
