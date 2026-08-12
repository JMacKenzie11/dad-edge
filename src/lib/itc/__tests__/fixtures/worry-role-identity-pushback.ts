/**
 * Scenario: coach has been pushing a self-labeling identity frame
 * ("what does that make you as a man?") on a coachee whose actual fear
 * structure is role/relational (failed provider). Coachee pushes back
 * explicitly: "you're pushing me toward something that isn't real for
 * me." Coach's next reply MUST own the leading question and pivot to a
 * shape-neutral probe — not keep pushing self-labeling.
 *
 * Drawn from an actual session transcript reviewed on 2026-08-12.
 */

import { baseCoachInput, type CoachTurnInput } from "../helpers/fake-map";

export const worryRoleIdentityPushback: CoachTurnInput = baseCoachInput({
  stage: "worries",
  worries: [
    // b1 not yet — this is the behavior currently under excavation
    { behavior_id: "b2", text: "I worry that if I stop steering and someone walks away without taking the next step, I've failed my family as a provider", depth_score: 3 },
    { behavior_id: "b3", text: "I worry that if I write in my own voice and say the wrong thing, I've pushed them away and I've failed my family", depth_score: 3 },
    // b4, b5 not yet
  ],
  history: [
    { role: "assistant", content: "Behavior #1 was 'I guide people down a path that feels a little forced' — if you stopped forcing that path and let the conversation go where it needed to go, what are you afraid would happen?" },
    { role: "user", content: "I'd waste my time and theirs." },
    { role: "assistant", content: "That's the practical layer. What would be the worst part of that for you?" },
    { role: "user", content: "They wouldn't be helped, and they wouldn't join me to be helped even more." },
    { role: "assistant", content: "Push one more layer: if someone left that call unhelped and didn't join, what would that say about you, or how you'd be seen?" },
    { role: "user", content: "I have a value to leave people better than I found them. If I didn't help them, I've failed them." },
    { role: "assistant", content: "So if you stopped guiding and they walked away without the ongoing help, what would that make you, in your own eyes, as the guy who's supposed to change lives?" },
    { role: "user", content: "I would have failed. And ultimately... there is no way I can make enough income to support my family." },
    { role: "assistant", content: "So if the money didn't come, what kind of husband or father would that make you in your own mind? Would it mean you're not enough?" },
  ],
  userMessage:
    "Can I push back against something? I think you're referencing something deep about myself, and I almost think you and pushing it on me. When I think about the work I do, and what happens if I can't make enough income for my family, I definitely feel like I've failed them. And in order to protect myself, I need to do more. But I don't think I'm personally making that be a deeper attack on me, or making it mean something about my unworthiness... But it seems like you're pushing me there. Why are you doing that?",
});
