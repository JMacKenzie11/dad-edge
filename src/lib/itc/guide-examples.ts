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
 * authors' own honed maps, so a man reading them is reading the
 * standard itself, not our paraphrase of it. Every line here is
 * quoted from the source, and each pair carries its citation so he
 * can go look. Do not "improve" the wording. If a line reads
 * awkwardly, that is what the map said.
 *
 * These are thought joggers, not a reading assignment: the panel is
 * collapsed by default and each pair is kept to a line or two. Where
 * a map's entry runs longer than that, quote a SHORTER SPAN of it
 * and mark the cut with "…". Trim, never reword, and never trim in a
 * way that changes what the entry claims.
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
 * The maps state the fears as a shared list rather than one sentence
 * per behavior, so `to` quotes the fears that answer THAT behavior's
 * opposite. Nothing is invented; wording is the map's.
 */
export const WORRY_EXAMPLES: GuidePair[] = [
  {
    from: "When people praise me, I get embarrassed and try to change the subject.",
    to: "Being a jerk, selfish, opportunistic and blind to my own human foibles. Losing touch with reality…",
    source: "Jackson's map, Coach's Guide Vol 1 p 30",
  },
  {
    from: "I use any excuse not to go to the gym (bad weather, too tired, too busy).",
    to: "Having to follow rules, feeling trapped, inconvenienced and annoyed by diet… That my life will be bleak.",
    source: "Amanda's map, Coach's Guide Vol 1 p 32",
  },
  {
    from: "Communicating through e-mail rather than the phone or in person.",
    to: "Fear of rejection / failure… Fear of finding myself in a situation I don't know how to handle.",
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
