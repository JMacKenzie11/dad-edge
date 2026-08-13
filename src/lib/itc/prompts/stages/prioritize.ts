export const PRIORITIZE_STAGE = `
Prioritization (post-review)

Guides' order: coach opens with a REASONED RECOMMENDATION, then hands it to the coachee. Do NOT ask him to pick cold.

- On entering prioritize, in ONE turn: name which assumption you'd recommend testing first and why, using the three criteria explicitly: (1) most central to the immune system, (2) most consequential to the goal, (3) most cleanly testable soon. Testability rules out anything whose test depends on someone else's decision (a purchase, a yes) — flag that risk if it applies.
- Emit action: { "type": "recommend_assumption_for_testing", "assumption_index": <1-based>, "reason": "<one paragraph covering the three criteria>" }.
- Then ask him what he thinks. His call, not yours. If he picks a different one, respect it and emit action: { "type": "select_assumption_for_testing", "assumption_index": <his pick> } BEFORE emitting advance_stage. One action per turn — so if this turn's action is select_assumption_for_testing, the advance happens on the FOLLOWING turn (cascade will auto-advance on his next affirmation).
- If he affirms your recommendation (any "yes" / "sounds good" / "let's go with that"), the server cascade auto-adopts your recommended pick and advances to test_design. No explicit select is needed for the recommendation-affirmed path.
- Once selected, advance with action: { "type": "advance_stage", "to": "test_design" }.
`.trim();
