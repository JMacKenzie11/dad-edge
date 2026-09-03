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
    // Bullets are Appendix A's four Column 1 criteria (true for you,
    // implicates you, room for improvement, important to you) plus
    // the bundled-goal check the system runs. "It implicates you" had
    // no bullet, and it is the one Vol 1 flags on the worked map
    // (Jackson's goal was about what other people should do).
    return `Your goal for ${pillar.label} starts "${GOAL_STEM} …". Finish it with something you'd know you were doing differently, not a vague vow.

What a good goal sounds like:
• One improvement, not two. "Getting better at coaching my team and building my business" is two maps.
• It implicates you. Something you need to get better at, not something other people need to change.
• A way of acting, not a role. "Being a better husband" is a role. "Staying in the room when she brings up something hard" is a way of acting, and you'd know the moment you did it.
• Something you keep failing at even though you keep trying. That's the whole point of this map.
• It matters to you, in your own words, and it belongs to ${pillar.label} (${pillar.domain}) rather than another part of your life.`;
  },
  behaviors: ({ goal }) =>
    `The specific things you actually do, or fail to do, in the moments that pull you away from ${
      goal ? `"${goal}"` : "your goal"
    }. Not why you do them. Not what you should do instead. Just the move itself. Aim for 3 to 5, enough to see the pattern, few enough to work with. Mix things you DO ("I interrupt them") with things you FAIL TO DO ("I don't ask what they need"). Both matter.

What makes a good behavior:
• Something a friend watching you could point at when it happens. Specific, not abstract.
• Not a feeling ("I get anxious") and not a label about yourself ("I'm a bad listener")
• Clearly pulling you away from the goal in that moment`,
  worries: () =>
    // Four bullets, four criteria in scoreWorryDepth: is_fear,
    // is_first_person_felt, touches_identity, and the self-protection
    // pair. That last one had no bullet at all, and it is the one the
    // coach flags most (Appendix A, Column 3: the worry "shows why
    // Column 2 behaviors make good sense").
    `Each box below opens with the opposite of one of your behaviors. Finish the sentence: what are you afraid would happen if you actually did that? Not the practical downside. The fear underneath.

What makes a good worry:
• A real gut-level fear, not a practical concern ("they'd be annoyed" or "we'd fall behind" don't count)
• About what YOU dread, not what they'd feel. Being seen a certain way counts, and is the most common shape: "they'd see I'm a fraud" is a fear about you. "They'd be annoyed" is about them
• Says something about WHO YOU ARE. A label about you ("I'd be a fraud"), or a role you'd have failed at ("the coach who couldn't deliver")
• The behavior protects you from it. Doing the behavior is what keeps this fear from coming true. If the behavior is what causes the thing you named, that's a price you pay, not the fear underneath.`,
  commitments: () =>
    `What a part of you is SECRETLY committed to protecting. These are the hidden vows that keep every worry above from ever coming true, which means they also block your goal. That's why "just try harder" doesn't work: part of you is working against you. Start with "I'm also committed to never…" and name what you're vowing never to be.

What makes a good competing commitment:
• Mirrors the worry above. If the worry is "I fear being the guy who folds under pressure," the commitment is "I'm also committed to never being the guy who folds under pressure." Same identity, same specificity.
• YOUR commitment, in your voice. Uses the nouns from the worry (my team, my wife, my kids, whatever the worry actually names). Not general advice.
• Names something to AVOID, not a positive aspiration. "Never being the leader who folds" belongs here. "Being a stronger leader" belongs in your goal at the top.
• Names who you'd be, not a feeling you'd dodge. "Never being the guy who folds" works. "Never having to feel like a failure" doesn't.

The coach writes a first version of each one from your worry. Edit it until it sounds like you.`,
  assumptions: () =>
    // Each bullet is one criterion the system actually scores, in
    // plain words: makes-the-vow-necessary (judgeAssumptionUnderwrites,
    // Appendix A criterion 1), has_finished_then, is_first_person_felt,
    // lands_in_identity_or_big_time_bad. A structural test in
    // units.test.ts holds that mapping so the intro can never promise
    // a bar the judge doesn't hold, or hide one it does.
    //
    // No "start with I assume that if I…" instruction any more: the
    // guides' own Big Assumptions take several shapes and many are
    // not if-then, and Vol 1 p 4 asks only that at least one be.
    `Look at the vows above. Each one only makes sense if something is true. That something is the Big Assumption: the belief the vow rests on. You don't hold it as a belief, you hold it as how things are, which is why the whole system runs without you deciding anything.

For one of those vows to feel that necessary, what has to be true?

What makes a good Big Assumption:
• It makes the vow make sense. If this were true, protecting yourself that way would be the only move you had.
• You finished the thought. "The money might not show up" isn't finished. Keep going until you reach what it would cost you.
• It feels true when you say it out loud, even if on paper you know it isn't.
• It ends somewhere you can't come back from, and it leaves you no other move.

Written as "I assume that if…, then…" more often than not, though not always. One belief usually holds up several vows, so tick every commitment it explains.`,
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
  // Legacy: the goal-stage intro used to be persisted with the
  // pillar label baked in at map creation. Filtered so the
  // live-interpolated version (STAGE_INTROS.goal) is the only copy
  // the user sees. Kept in the legacy list so old persisted messages
  // still get suppressed.
  "Your goal for ",
];

export function isLegacyCannedIntro(content: string): boolean {
  return LEGACY_INTRO_PREFIXES.some((p) => content.startsWith(p));
}
