/**
 * Worked pairs lifted from the Kegan & Lahey Coach's Guides, shown to
 * the coachee in a collapsed panel on Columns 3 and 5.
 *
 * Why they exist: both columns ask him to connect two things, and the
 * connection is the part a blank box can't teach. He can read what a
 * good worry is and still not see how it grows out of the behavior
 * sitting above it. One worked pair does that in a way three bullets
 * of criteria don't.
 *
 * Why they come from the guides rather than from us: these are the
 * authors' own honed maps, so the fears and beliefs a man reads here
 * are the real ones, not our invention of what a good entry sounds
 * like. Each pair carries its citation so he can go look.
 *
 * ONE DELIBERATE DEPARTURE. The guides write Column 3 as a "fear
 * box": a shared list of fragments ("Being a jerk, selfish,
 * opportunistic..."), not a sentence per behavior. This app asks for
 * a sentence opening "I worry that if I ...". An example that does
 * not take the form the box asks for teaches the wrong thing twice:
 * he copies the shape he sees, and then the coach flags it. So the
 * worries below carry the guides' own fear WORDS in this app's
 * sentence form. The assumptions needed no such change; the guides
 * already write those "I assume that ...".
 *
 * The rule that follows: change the FRAME, never the content. Keep
 * the map's own nouns and dreads, and never sharpen a fear into
 * something more quotable than the person actually wrote.
 *
 * Thought joggers, not a reading assignment: the panel is collapsed
 * by default and each pair is a line or two. Where a map's entry
 * runs longer, use a SHORTER SPAN of it and mark the cut with "...".
 *
 * Three maps: Jackson (Vol 1 p 30), Amanda (Vol 1 p 32) and Andrew
 * (Vol 2 p 280). Amanda's is a woman's map, kept as written.
 *
 * Deliberate: the assumption examples include BOTH shapes, an
 * if-then and a flat belief ("I assume that saying anything about my
 * accomplishments is bragging"). Vol 1 p 4 asks only that at least
 * one assumption on a map be in if-then form, and showing only
 * if-thens here would teach the requirement we removed from the
 * rubric. See src/lib/itc/__tests__/assumption-shape.test.ts.
 */

export type GuidePair = {
  /** The upstream entry: the behavior (Column 3) or the competing
   *  commitment (Column 5). */
  from: string;
  /** The entry it produced: the worry, or the Big Assumption. */
  to: string;
  /** Whose map, and where to find it. */
  source: string;
};

/**
 * Behavior -> the fear that doing its opposite would bring on.
 *
 * The guides make this pairing themselves (Vol 1 p 13): "ask your
 * client which of the Column 2 behaviors she believes is the most
 * significant counter to her Column 1 goal. Use that one as your
 * starting place for generating material for the fear box." So the
 * fear box is generated against a chosen behavior, which is exactly
 * the move this column asks of him.
 *
 * `from` is the map's behavior verbatim. `to` puts that same map's
 * fear words into this app's sentence form, opening "I worry that if
 * I <the opposite of that behavior>, ..." per the departure noted at
 * the top of this file. The counter-move in each opening is the
 * plain opposite of the behavior beside it, nothing more.
 */
export const WORRY_EXAMPLES: GuidePair[] = [
  {
    from: "When people praise me, I get embarrassed and try to change the subject.",
    to: "I worry that if I let the praise land, I’d be a jerk, selfish and opportunistic, blind to my own human foibles.",
    source: "Jackson's map, Coach's Guide Vol 1 p 30",
  },
  {
    from: "I use any excuse not to go to the gym (bad weather, too tired, too busy).",
    to: "I worry that if I went to the gym anyway, I’d be trapped following someone else’s rules, and my life would be bleak.",
    source: "Amanda's map, Coach's Guide Vol 1 p 32",
  },
  {
    from: "Communicating through e-mail rather than the phone or in person.",
    to: "I worry that if I picked up the phone instead, I’d be rejected, or end up somewhere I don’t know how to handle.",
    source: "Andrew's map, Coach's Guide Vol 2 p 280",
  },
];

/**
 * Competing commitment -> the Big Assumption that makes it feel
 * necessary. This is the Vol 1 p 17 move: the assumption is what has
 * to be true for the vow to make sense.
 */
export const ASSUMPTION_EXAMPLES: GuidePair[] = [
  {
    // Andrew's Column 4 is printed under one shared "I assume that
    // if..." header with the three assumptions numbered beneath it,
    // so the stem is folded back in here to make a whole sentence.
    from: "Committed to not finding out that I can't do this work.",
    to: "I assume that if I take social risks, I might say the wrong thing… people will question my professionalism, and I will feel like a failure.",
    source: "Andrew's map, Coach's Guide Vol 2 p 280",
  },
  {
    from: "I am committed to not fitting the mold of the “asshole” executive.",
    // Flat, no "if", no "then", and the guides treat it as a real Big
    // Assumption. Kept here on purpose.
    to: "I assume that saying anything about my accomplishments is bragging.",
    source: "Jackson's map, Coach's Guide Vol 1 p 30",
  },
  {
    from: "I am committed to always feeling the freedom of having lots of options, making my own decisions…",
    to: "I assume that if I don't have lots of options, I will feel resentful, angry, impotent, and stressed. Life will be bleak.",
    source: "Amanda's map, Coach's Guide Vol 1 p 32",
  },
];
