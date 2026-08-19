import type { ItcStage } from "./stage";

/**
 * Client-rendered stage intros. Never persisted, never LLM-generated
 * — pure static text with live map-state interpolation at render time.
 *
 * Persisted stage-note messages used to carry a snapshot of the goal
 * baked into their prose (e.g. `Column 2 is what you actually do
 * against "old goal"...`). When the goal changed, the stored copy went
 * stale and there was no way to refresh it. Interpolating from live
 * state at render time eliminates the whole class of stale-quote bugs.
 */
export const STAGE_INTROS: Partial<
  Record<ItcStage, (ctx: { goal: string | null }) => string>
> = {
  behaviors: ({ goal }) =>
    `Column 2 is what you actually do, or fail to do, in the moment that works against ${
      goal ? `"${goal}"` : "your goal"
    }. Not why. Not what you should do instead. Just the specific behavior. Aim for 3 to 5 — enough to see the pattern, few enough to work. What's the first one that comes to mind?`,
  worries: () =>
    `Column 3 is the worry box. For each Column 2 behavior, name the fear underneath. Not a practical concern like "she'd get upset" or "we'd fall behind" — a first-person felt fear about YOU. Imagine yourself doing the opposite of that behavior in a real moment: what would that expose about who you are, or how you'd be seen? Push until it lands on identity — that's the depth.`,
  commitments: () =>
    `Column 4 is what you're SECRETLY committed to. Every worry in Column 3 points at a hidden commitment you're keeping.`,
  assumptions: () =>
    `Column 5 is the Big Assumptions underneath the hidden commitments. What do you assume would happen if you broke a competing commitment?`,
  review: () =>
    `Before we test anything, take a beat and look at the whole map. What jumps out? Anything you'd sharpen or reword?`,
  immune_system: () =>
    `Now the walkthrough. I'm going to show you how the columns interlock, how the behaviors, the worries, the hidden commitments, and the Big Assumptions all protect the same thing.`,
  prioritize: () =>
    `You've mapped the whole immune system. Now: which Big Assumption do you want to test first? The best one to start on is usually the one that, if it turned out not to hold, would loosen the most of the system.`,
  test_design: () =>
    `Design a test for the assumption you picked. Four fields: what the assumption says, what you'll do differently, what data you'll collect, what you'll find out.`,
  test_running: () =>
    `Test is designed. Go run it. Come back with what you observed.`,
  results: () =>
    `You ran the test. Tell me what you did, what you observed, and what you make of it.`,
  done: () =>
    `Your map stays here. Come back anytime you want to design another test, revisit an assumption, or work on a different pillar.`,
};

/**
 * Prefix matchers used to skip legacy stored stage_note messages that
 * carried the old server-baked intros. Any stored message starting
 * with one of these is presumed to be a legacy canned intro and is
 * suppressed at render time — the client-side STAGE_INTROS above
 * renders the live version instead.
 *
 * Genuine LLM output (suggestion prose, etc.) never opens with these
 * headings, so the false-positive risk is low. If a future coach
 * response ever needs to start with "Column 2 is...", update this
 * list to be more specific.
 */
export const LEGACY_INTRO_PREFIXES: readonly string[] = [
  "Column 2 is what you actually do",
  "Column 3 is the worry box",
  "Column 4 is what you're SECRETLY committed",
  "Column 5 is the Big Assumptions",
  "Before we test anything",
  "Now the walkthrough",
  "You've mapped the whole immune system",
  "Design a test for the assumption",
  "Test is designed",
  "You ran the test",
  "Your map stays here",
];

export function isLegacyCannedIntro(content: string): boolean {
  return LEGACY_INTRO_PREFIXES.some((p) => content.startsWith(p));
}
