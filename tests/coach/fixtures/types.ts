import type { ContextBlock } from "@/lib/coach/context";
import type { Mode } from "@/lib/coach/prompts";

/**
 * A scenario fixture: everything the coach needs to see plus the
 * conversation prompt to react to. The runner assembles these into
 * the same system-prompt shape send-message.ts uses in production,
 * calls Anthropic, and prints the reply.
 *
 * Fixtures live on disk (versioned) instead of being fetched from
 * the DB. This gives us:
 *   - repeatable transcripts across environments
 *   - no DB writes on every coach-quality review
 *   - no real user's private data landing in a code review
 *   - the input right next to the output so a review reads cleanly
 *
 * The DB-to-context path is unit-tested separately in
 * tests/coach/context.test.ts. That test proves the pipeline
 * assembles correctly; these fixtures test the coach's reply given
 * assembled context.
 */
export interface Scenario {
  /** Fixture identifier used in the output header and in filenames. */
  slug: string;
  /** Short description shown at the top of the transcript. */
  headline: string;
  /** general or mission — determines which system prompt runs. */
  mode: Mode;
  /** Provider blocks in the order they'd appear post-assembly.
   *  Group cacheable first (identity/family/survey) then volatile
   *  (goals/missions/streaks/reflections/itc); the runner respects
   *  the array order rather than re-sorting. */
  cacheable: ContextBlock[];
  volatile: ContextBlock[];
  /** Optional recent turns of the conversation. Empty means the man
   *  is starting fresh. Roles are user/assistant, alternating. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** The user turn the coach is about to respond to. */
  userMessage: string;
}
