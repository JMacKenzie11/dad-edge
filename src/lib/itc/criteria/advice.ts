/**
 * SINGLE SOURCE OF TRUTH for the coachee-facing "what's off" line.
 *
 * Every surface that tells the coachee what to fix reads from here:
 * the row box under an entry (fixes.ts → render.ts renderRowSharpen),
 * the end-of-column review and the hone audit (render.ts), and the
 * drafter retry loops in coach.ts that feed the same line back to
 * the LLM as rewrite instructions.
 *
 * Voice: these are coach sentences, not error messages. Second
 * person, contractions, plain nouns, one point each. No machinery
 * words (rubric, score, criterion), no interface words, no
 * announcing ("let me sharpen"). The line says what's off and what
 * the fixed version does. The fixed version itself comes from the
 * drafters as Finding.suggestedFix; the line never has to carry it.
 *
 * RULES for editing:
 *   1. Advice must agree with the depth rubrics in rubric.ts. If a
 *      line suggests a rewrite pattern, that pattern has to PASS the
 *      matching rubric. advice-alignment.test.ts guards the known
 *      failure (interior-witness advice suggesting a "she'd see"
 *      pivot the worry rubric rejects).
 *   2. Never introduce a pronoun or relational noun the coachee
 *      hasn't used. Use "[role]" placeholders, not "she".
 *   3. Adding an IssueType means adding a line here. The type system
 *      and the exhaustiveness test both enforce it.
 */

import type { IssueType } from "./types";

export const ADVICE: Record<IssueType, string> = {
  bundled_goal:
    "This is two goals in one. Pick one for this map and save the other for the next one.",

  depth_shortfall_behavior:
    "A friend standing next to you couldn't point at this. Name the specific move you make, in the moment, that works against your goal.",

  depth_shortfall_worry:
    "This stops at what would happen. Finish it: if you did the opposite of the behavior, who would you be?",

  depth_shortfall_commitment:
    "This stops short of who you're protecting. Name the guy you're vowing never to be, in the same words as the worry.",

  // Was "Finish it: if that happened, who would it make you?" That
  // asked for an identity. Appendix A does not ask that of Column 4,
  // and Column 3 has already named it, so following this advice
  // produced the worry again under a new opening (2026-09-03).
  // Appendix A wants a Big Time Bad conclusion and a contracted world.
  depth_shortfall_assumption:
    "This stops at something you could live with. If it were true, what would it cost you, and what would you have left?",

  // Agrees with scoreWorryDepth.is_first_person_felt, which rejects
  // worries that center on the other person's reaction. The fix stays
  // in his own dread and finishes on a named identity.
  interior_witness_worry:
    "This one lives inside your own head (\"I'd have to see I…\"). Finish on who you'd be instead: \"I worry I'd be the [role] who…\". Someone else's reaction isn't the fear. Who you'd be is.",

  interior_witness_commitment:
    "This vows to dodge a feeling. Vow against the identity and the move instead: \"never being the [role] who [does the thing]\".",

  commitment_doesnt_mirror_worry:
    "This doesn't carry the worry it came from. Same guy, same words: take the worry and rewrite it as \"I'm also committed to never…\".",

  vague_assumption_then_clause:
    "\"The guy I'm terrified of\" hides who that is. Write him out.",

  assumption_uncovered_commitment:
    "No Big Assumption holds this one up yet.",

  // Fallback only. The renderer builds the real sentence from
  // Finding.unfitCommitmentPositions ("Believing this makes #1 and #3
  // feel necessary, not #2…").
  // Both of these used to tell him to rewrite "the if". A Big
  // Assumption does not need one: Vol 1 p 4 asks only that at least
  // one on a map be in if-then form, and Appendix A never mentions
  // it. A man whose belief reads "clients won't hire me unless I
  // agree to whatever they want" was told to rewrite an "if" that
  // wasn't there (2026-09-03).
  assumption_doesnt_underwrite:
    "Believing this doesn't make every vow it's tied to feel necessary. Take the ones it doesn't hold up off this one, or say what you'd have to believe for those vows to matter this much.",

  // Also dropped the "start it with you doing the opposite of one of
  // your behaviors" instruction: anchoring the belief on a Column 2
  // counter-move is what produced assumptions that restated the
  // worry, fixed in de376db. What this check actually wants is
  // something testable.
  assumption_not_enactable:
    "There's nothing here you could put to the test this week. Name something you could actually do differently, so you can find out whether the belief holds.",

  test_coverage_gap:
    "This one has no test yet. Without one you've got no data to hold it up against.",

  test_grip_through_data:
    "What will you actually collect that could prove the assumption wrong? Name that data.",
};
