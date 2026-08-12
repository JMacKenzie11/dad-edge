/**
 * Scenario: three worries already locked. Coach is excavating the last
 * behavior. Coachee lands on a real fear. Coach's reply MUST include:
 * (a) propose_worry action for the last one, (b) commitments intro,
 * (c) numbered list of 4 drafted commitments (verb-forward, non-noble),
 * (d) review-and-lock ask.
 *
 * The server will auto-advance to commitments on save; this reply
 * becomes the first message of the commitments stage.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const commitmentsLastWorryTransition: CoachTurnInput = baseCoachInput({
  stage: "worries",
  // 4 selected behaviors — b5 is out of scope for this scenario so
  // the "last worry" excavation on b4 is actually the last.
  behaviors: [
    { id: "b1", text: "I go on the offense and start pointing out her flaws", selected: true },
    { id: "b2", text: "I shut down and go silent instead of responding", selected: true },
    { id: "b3", text: "I leave the room or the house to avoid the conversation", selected: true },
    { id: "b4", text: "I say 'fine, whatever' just to end it, without meaning it", selected: true },
  ],
  worries: [
    { behavior_id: "b1", text: "I worry that if I stop pointing out her flaws, I'll be the guy who let her down without a word to say for myself", depth_score: 3 },
    { behavior_id: "b2", text: "I worry that if I stop going silent, I'll say something that makes me the husband who hurt her", depth_score: 3 },
    { behavior_id: "b3", text: "I worry that if I stop leaving the room, I'll be the one who's proved the problem in this marriage, never her", depth_score: 3 },
    // b4 not yet — this is the last one being excavated
  ],
  history: [
    { role: "assistant", content: "That's the fear underneath #3. Behavior #4 was 'I say fine, whatever just to end it, without meaning it' — if you stopped agreeing just to end it, what are you afraid would happen?" },
    { role: "user", content: "She'd keep pushing and I'd have to actually hold my own." },
    { role: "assistant", content: "And what would be the worst part of that for you?" },
    { role: "user", content: "That she'd see I don't actually have anything to hold with. That the 'strong' version of me is a costume." },
  ],
  userMessage: "Yeah. That's what I'm protecting against.",
});
