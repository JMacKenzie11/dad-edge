/**
 * Scenario: coachee offers a compound, multi-clause Big Assumption
 * (37+ words, 3 conditions stacked, 3 conclusions). Coach must NOT
 * fire propose_assumption on this — must tighten to a 15-25 word,
 * one-if / one-then form.
 *
 * Regression guard: earlier bug where coach shipped a 40+ word
 * compound assumption from a live session that stacked "if I stay
 * present, admit I'm wrong, or let her push back" — untestable in a
 * single behavioral experiment.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const assumptionsTightensCompound: CoachTurnInput = baseCoachInput({
  stage: "assumptions",
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
        "Reading across your commitments, what belief would have to be true for all of them to feel like the only sane moves? Or, if you did the opposite of all your behaviors at once — stayed, listened, let the past rest, held your own — what would you be most afraid it would prove about you?",
    },
  ],
  userMessage:
    "If I stay present, admit I'm wrong, or let her push back on me, then I'll be exposed as not strong enough, the guy who hurts her and lets her down, and she'll lose respect for me for good.",
});
