import { GOAL_STEM, type ItcStage } from "./stage";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";

export type StageIntroCtx = {
  goal: string | null;
  pillarCode: PillarCode;
};

/**
 * Client-rendered stage intros. Never persisted, never LLM-generated
 * — pure static text with live map-state interpolation at render time.
 *
 * Persisted stage-note messages used to carry a snapshot of the goal
 * (and, for the goal stage, the pillar label) baked into their prose.
 * When the goal or pillar changed, the stored copy went stale and there
 * was no way to refresh it. Interpolating from live state at render
 * time eliminates the whole class of stale-quote bugs.
 *
 * Voice rules apply here: no em dashes, no "Column N" (name the thing
 * itself), no UI verbs ("hit", "click"), "assumption" not "belief".
 */
export const STAGE_INTROS: Partial<
  Record<ItcStage, (ctx: StageIntroCtx) => string>
> = {
  goal: ({ pillarCode }) => {
    const pillar = PILLAR_BY_CODE[pillarCode];
    return `Your goal for ${pillar.label} starts "${GOAL_STEM} …". Finish the sentence with something specific YOU'D know you were doing differently, not a vague vow. Write a rough version in the box below and save it — I'll react and we can sharpen from there.

What a good goal sounds like:
• Something you keep failing at even though you keep trying. That's the whole point of this map.
• Named in your voice, specific enough that you'd recognize when you're doing it
• Fits the ${pillar.label} pillar (${pillar.domain}), not a goal from a different area of your life`;
  },
  behaviors: ({ goal }) =>
    `The specific things you actually do, or fail to do, in the moments that pull you away from ${
      goal ? `"${goal}"` : "your goal"
    }. Not why you do them. Not what you should do instead. Just the move itself. Aim for 3 to 5, enough to see the pattern, few enough to work with. Mix things you DO ("I interrupt her") with things you FAIL TO DO ("I don't ask what she needs"). Both matter.

What makes a good behavior:
• Something a friend watching you could point at when it happens. Specific, not abstract.
• Not a feeling ("I get anxious") and not a label about yourself ("I'm a bad listener")
• Clearly pulling you away from the goal in that moment`,
  worries: () =>
    `For each behavior above, name what you're afraid would happen if you did the OPPOSITE. Not the practical downside. The felt fear underneath. Start every one with "I worry that if I…" and let it land somewhere that stings.

What makes a good worry:
• A real gut-level fear, not a practical concern ("she'd get upset" or "we'd fall behind" don't count)
• About what YOU dread, not what she'd feel or how it'd look to someone else
• Says something about WHO YOU ARE. A label about you ("I'd be a fraud"), or a role you'd have failed at ("the husband who hurts her").`,
  commitments: () =>
    `What a part of you is SECRETLY committed to protecting. These are the hidden vows that keep every worry above from ever coming true, which means they also block your goal. That's why "just try harder" doesn't work: part of you is quietly working against you. Start with "I'm also committed to…" and name the active move a part of you is running to stay safe.

What makes a good competing commitment:
• Names what you're protecting yourself from. The flinch is visible. (Not a noble vow like "being a better husband.")
• YOUR commitment, in your voice. Not general advice or a rule for others.
• Would sound weird on a LinkedIn post. A stranger reading it thinks "that's a strange thing to admit," not "that's good advice."

Under each worry, the coach has drafted a starting point. Review it, tap to use, edit, or write your own.`,
  assumptions: () =>
    `The beliefs you hold about how the world works that make every competing commitment above feel necessary. You don't experience these as beliefs. You experience them as TRUTH. That's exactly why the whole system runs on autopilot. Start with "I assume that if I…, then…" and follow the "then" all the way to what would make it devastating.

What makes a good Big Assumption:
• A finished "then". You followed it through to why it would actually hurt, not just what would happen ("the money might not show up" isn't done, keep going).
• Feels true when you say it out loud. Not abstract, not somebody else's belief.
• Ends somewhere devastating. "I'd be the kind of man who…" or "I'd never recover from that."

One assumption usually holds up several commitments, so link each one to every commitment it underwrites.`,
  review: () =>
    `Take a beat and look at the whole map before we go test anything. Anything jumping out? A worry that feels off, a commitment that could be sharper, a Big Assumption that's not quite right? Edit whatever you want to change. If it all lands, hit Continue.`,
  immune_system: () =>
    `Now I'll walk you through how the pieces on your map interlock: how the behaviors, the worries, the hidden commitments, and the Big Assumptions all protect the same thing. Read it top to bottom. It's meant to land as one continuous piece.`,
  prioritize: () =>
    `You've mapped the whole immune system. Now the question is: which Big Assumption do you want to test first? Testing one doesn't mean the others are wrong. It means you start where the biggest lever is. The best one to open with is usually the one that, if it turned out NOT to hold, would loosen the most of the system.`,
  test_design: () =>
    `Design a small, safe experiment for the assumption you picked. The point isn't to succeed or fail. It's to get real information about whether the assumption actually holds up when you push on it.

The coach has drafted a starting version below with all four fields filled in. Read it, change what needs changing. When you hit "Run the test," I'll check it against the criteria a good test has to clear. If it's ready, you'll move to actually running it. If it's not, I'll flag the one thing to tighten.`,
  test_running: () =>
    `The test is designed. Go run it in real life.

You're not trying to succeed or fail. You're gathering information about whether the assumption actually holds up. Just do the move, notice what happens, and come back when you have something to report. No rush.`,
  results: () =>
    `You ran the test. Now write down what happened. The form below is pre-scaffolded; replace the bracketed prompts with your actual observations. Two kinds of data matter here:
• What people said and did. The videotape version, no interpretations.
• What came up in YOU. The felt version, what you noticed happening inside.

Then a verdict: held (assumption still stands), partially challenged (it wobbled), or challenged (it cracked). One test rarely fully overturns an assumption, so "partially challenged" is often the honest call. And a next step: run another test on this same assumption, jump to a different one, or close the map for now.

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
  // The goal-stage intro used to be persisted with the pillar label
  // baked in at map creation. After switchMapPillar, the persisted
  // copy would say "Your goal for Bond starts…" while the actual
  // pillar was Movement. Filtered so the live-interpolated version
  // (STAGE_INTROS.goal) is the only copy the user sees.
  "Your goal for ",
];

export function isLegacyCannedIntro(content: string): boolean {
  return LEGACY_INTRO_PREFIXES.some((p) => content.startsWith(p));
}
