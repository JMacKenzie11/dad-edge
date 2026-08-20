import type { ItcStage } from "./stage";

/**
 * Client-rendered stage intros. Never persisted, never LLM-generated
 * — pure static text with live map-state interpolation at render time.
 *
 * Persisted stage-note messages used to carry a snapshot of the goal
 * baked into their prose. When the goal changed, the stored copy went
 * stale and there was no way to refresh it. Interpolating from live
 * state at render time eliminates the whole class of stale-quote bugs.
 *
 * Voice rules apply here: no em dashes, no "Column N" (name the thing
 * itself), no UI verbs ("hit", "click"), "assumption" not "belief".
 */
export const STAGE_INTROS: Partial<
  Record<ItcStage, (ctx: { goal: string | null }) => string>
> = {
  behaviors: ({ goal }) =>
    `The behaviors you actually do, or fail to do, in the moments that work against ${
      goal ? `"${goal}"` : "your goal"
    }. Not why. Not what you should do instead. Just the specific behavior.

Aim for 3 to 5. Enough to see the pattern, few enough to work with. What's the first one that comes to mind?`,
  worries: () =>
    `The worry box. For each behavior above, name the fear underneath.

Not a practical concern like "she'd get upset" or "we'd fall behind". A first-person felt fear about YOU. Imagine yourself doing the opposite of that behavior in a real moment. What would that expose about who you are, or how you'd be seen?

Push until it lands on identity. That's the depth.`,
  commitments: () =>
    `What a part of you is SECRETLY committed to. The hidden self-protective vows that keep every worry above from coming true.

They compete DIRECTLY with your goal, which is why "just try harder" hasn't worked.

They shouldn't sound noble ("being a good listener"). They should sound self-protective and a little strange to say out loud ("never having to find out my effort didn't matter").

Under each worry the coach has drafted a starting point. Review, tap to use, edit, or type your own.`,
  assumptions: () =>
    `Your Big Assumptions. The assumptions about how the world works that make every competing commitment above feel necessary.

Every one starts with "I assume that if I…, then…" and lands somewhere catastrophic ("I'd be nothing", "I'd lose them", "I'd fall apart"). To you they don't feel like assumptions. They feel like TRUTH. That's exactly why the immune system runs on autopilot.

One assumption often underwrites several commitments, so link each one to every commitment it holds up.

Naming them is the first move. Testing them is what breaks the immunity.`,
  review: () =>
    `Before we test anything, take a beat and look at the whole map. What jumps out? Anything you'd sharpen or reword?`,
  immune_system: () =>
    `Now the walkthrough. I'm going to show you how the pieces interlock: how the behaviors, the worries, the hidden commitments, and the Big Assumptions all protect the same thing.`,
  prioritize: () =>
    `You've mapped the whole immune system. Now: which Big Assumption do you want to test first? The best one to start on is usually the one that, if it turned out not to hold, would loosen the most of the system.`,
  test_design: () =>
    `Design a small, safe experiment for the assumption you picked. The point isn't to succeed or fail. It's to gather real information about whether the assumption actually holds.

I've drafted a starting version below with all four fields filled in. Read it, change what needs changing. When you're ready to run the test I'll check it against the criteria a good test has to clear. If it's ready, you'll move to running it. If not, I'll flag the one thing to tighten.`,
  test_running: () =>
    `The test is designed. Go run it in real life.

You're not trying to succeed or fail. You're gathering information about whether the assumption actually holds. Just do the move, notice what happens, and come back when you have observations.

No rush. Come back to debrief when you're ready.`,
  results: () =>
    `You ran the test. Now write down what happened.

The form below is pre-scaffolded. Replace the bracketed prompts with your actual observations. Two kinds of data: what people said and did (the videotape version), and what came up in you (the felt version). Not interpretations.

Then a verdict: held, partially challenged, or challenged. One test rarely fully overturns an assumption, so partially challenged is often the honest read. And a next step: another test on this same assumption, a different assumption, or close the map for now.

I'll review after you save.`,
  done: () =>
    `You've closed the map for now. The coach's closing summary is below.`,
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
