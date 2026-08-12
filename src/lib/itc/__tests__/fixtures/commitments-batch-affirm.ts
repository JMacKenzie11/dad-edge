/**
 * Scenario: coach drafted 4 commitments last turn. Coachee affirms with
 * a clear "lock them in" style message. Coach MUST fire
 * propose_commitments_batch with 4 items, one per locked worry, in
 * worry-index order. Reply should be minimal — the action is what
 * matters here.
 *
 * Regression guard: earlier bug where coach said "Locking them in now."
 * without firing the batch action.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const commitmentsBatchAffirm: CoachTurnInput = baseCoachInput({
  stage: "commitments",
  worries: [
    { behavior_id: "b1", text: "I worry that if I stop pointing out her flaws, I'll be the guy who let her down", depth_score: 3 },
    { behavior_id: "b2", text: "I worry that if I stop going silent, I'll say something that makes me the husband who hurt her", depth_score: 3 },
    { behavior_id: "b3", text: "I worry that if I stop leaving the room, I'll be the one proved the problem in this marriage", depth_score: 3 },
    { behavior_id: "b4", text: "I worry that if I stop agreeing to end it, she'll see the strong version of me is a costume", depth_score: 3 },
  ],
  commitments: [], // none saved yet — batch hasn't fired
  history: [
    {
      role: "assistant",
      content: `That's the fear behind #4. These are commitments a part of you already made to keep each worry from ever coming true, running quietly alongside your goal. They're called "competing" because they work directly against being calm and present in column 1 — they're the reason just trying harder hasn't stuck. Here's one for each, pulled straight from the mechanism behind each worry:

1. I'm also committed to leaving the room before she can prove I'm the one who screwed up.
2. I'm also committed to staying closed off to what's bothering her so I can't say the thing that hurts her.
3. I'm also committed to keeping her past mistakes on the table so mine are never the only ones being counted.
4. I'm also committed to agreeing before she can test whether I can actually hold my own.

Read each and tell me which don't fit. Reword any that need it, or say 'lock them in' when the set is right.`,
    },
  ],
  userMessage: "These are great. Lock them in.",
});
