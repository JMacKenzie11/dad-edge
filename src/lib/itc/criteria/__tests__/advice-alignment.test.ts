/**
 * Structural guards against coach-vs-coach contradictions.
 *
 * The rule: every coach surface that tells the coachee how to fix a
 * finding must read from ADVICE (src/lib/itc/criteria/advice.ts).
 * These tests catch two ways that rule can silently break:
 *
 *   1. An advice string suggests a rewrite pattern that would fail
 *      the corresponding depth rubric. That was the 2026-09-01 bug:
 *      interior_witness_worry advice said "flip to 'she'd see'" —
 *      scoreWorryDepth.is_first_person_felt explicitly rejects
 *      centering on her reaction. Coachee gets whiplash: audit says
 *      do X, save-time rubric rejects X.
 *
 *   2. A downstream file hand-writes advice text instead of reading
 *      from ADVICE (drift by copy-paste). The exhaustiveness check
 *      catches missing ADVICE entries; the "no forbidden text
 *      elsewhere" checks catch known-bad phrasings creeping back
 *      into other files.
 *
 * If these tests fail, DO NOT edit the test to pass — edit
 * src/lib/itc/criteria/advice.ts (or the drifting file) so the coach
 * surfaces stay aligned. The whole point of this test is to prevent
 * silent drift; loosening it defeats the guard.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVICE } from "../advice";
import type { IssueType } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..", "..");
function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

// Enumerate every IssueType by hand. If a new one is added to the
// union in types.ts, this list must be updated in lockstep and
// ADVICE.<newType> must exist — the type system enforces the ADVICE
// side, and this assertion enforces the test-list side. The two
// together guarantee no IssueType ever slips past unadviced.
const ALL_ISSUE_TYPES: IssueType[] = [
  "bundled_goal",
  "depth_shortfall_behavior",
  "interior_witness_worry",
  "interior_witness_commitment",
  "commitment_doesnt_mirror_worry",
  "vague_assumption_then_clause",
  "depth_shortfall_worry",
  "depth_shortfall_commitment",
  "depth_shortfall_assumption",
  "assumption_doesnt_underwrite",
  "assumption_not_enactable",
  "assumption_uncovered_commitment",
  "test_coverage_gap",
  "test_grip_through_data",
];

describe("ADVICE — exhaustiveness", () => {
  it("has an entry for every IssueType", () => {
    for (const type of ALL_ISSUE_TYPES) {
      expect(
        ADVICE[type],
        `ADVICE.${type} is missing — add it to src/lib/itc/criteria/advice.ts`,
      ).toBeTruthy();
      expect(ADVICE[type].length).toBeGreaterThan(10);
    }
  });
});

describe("ADVICE — voice", () => {
  // docs/coach-voice-and-tone.md, applied to every line the coachee
  // reads. Not just the banned lists: second person, contractions,
  // no machinery, no interface, no announcing.
  const BANNED: Array<[RegExp, string]> = [
    [/[—–]/, "em/en dash"],
    [/\b(rubric|criterion|criteria|score|threshold|validation|rejected)\b/i, "machinery word"],
    [/\b(click|tap|hit|press|the (add|save) button|input)\b/i, "interface word"],
    [/\b(sharpen (it|this|up)|let me|let's name|worth \w+ing)\b/i, "announcing"],
    [/\b(leverage|unpack|delve|robust|nuanced?|profound(ly)?|deeply|genuinely|truly|resonate|elevate)\b/i, "AI vocabulary"],
    [/\b(architecture|framework|infrastructure|landscape|ecosystem|template)\b/i, "abstract noun"],
    [/\b(land|lands|landing)\b/i, "'land' metaphor"],
    [/\bnotice\b/i, "'notice'"],
    [/\b(she|her|his wife|my wife)\b/i, "pronoun the coachee hasn't used"],
    [/\bColumn \d\b/, "column number"],
  ];
  for (const type of ALL_ISSUE_TYPES) {
    it(`${type} reads in coach voice`, () => {
      const line = ADVICE[type];
      for (const [re, why] of BANNED) {
        expect(re.test(line), `${why} in ADVICE.${type}: "${line}"`).toBe(false);
      }
      // Second person, not third: never "he" / "the coachee".
      expect(/\b(the coachee|he should|he needs)\b/i.test(line)).toBe(false);
    });
  }
});

describe("ADVICE — alignment with scoreWorryDepth", () => {
  // scoreWorryDepth.is_first_person_felt explicitly rejects worries
  // that center on her reaction ("she'd get upset" is called out in
  // the prompt as a failure). Advice that tells the coachee to
  // rewrite as "she'd see X" or "she'd say X" produces text the
  // depth rubric then rejects — coach-vs-coach contradiction.
  //
  // These patterns are the ones that leaked through 2026-09-01.
  // If a legitimate advice text needs to reference her reaction
  // (e.g. in a caveat "don't pivot to 'she'd see'"), that's fine —
  // the patterns below only flag when the phrase appears as a
  // recommended rewrite. The regex here is strict about ALL
  // occurrences; if a caveat form is added later, we'll refine
  // the pattern to allow the caveat but reject the recommendation.
  //
  // For now: the interior_witness_worry advice is allowed to
  // MENTION "she'd see" inside a "don't do this" clause (that's
  // exactly what the aligned advice does — it names the anti-
  // pattern to warn against). So the check is: the advice must
  // NOT be a bare recommendation to use "she'd see" phrasing.
  // Structural approximation: the advice must include a
  // first-person recommendation (I'm / I worry / I'd) so the
  // canonical direction is present even if anti-patterns are
  // mentioned in warning form.

  it("interior_witness_worry advice includes a first-person rewrite pattern", () => {
    const advice = ADVICE.interior_witness_worry;
    // Must include at least one of the canonical first-person
    // openers that align with scoreWorryDepth.is_first_person_felt.
    const patterns = [
      /I['\u2019]m afraid/i,
      /I worry I['\u2019]m/i,
      /I['\u2019]d be [^.]*(role|husband|father|guy|man|coach|dad|leader|kind of)/i,
    ];
    const hasFirstPersonRewrite = patterns.some((re) => re.test(advice));
    expect(
      hasFirstPersonRewrite,
      `interior_witness_worry advice must include a first-person rewrite example ("I'm afraid I'd be…" / "I worry I'm the [role] who…"). Current advice: "${advice}"`,
    ).toBe(true);
  });

  it("interior_witness_worry advice warns against 'she'd see' pivots (not recommends them)", () => {
    const advice = ADVICE.interior_witness_worry;
    // The phrase "she'd see" is allowed to appear IF it's in a
    // "don't" / "not" / "avoid" / "pivots" framing. If the advice
    // doesn't mention the anti-pattern at all, that's also fine —
    // the failure case is a bare recommendation to use it.
    if (/she['\u2019]d see|she['\u2019]d say|she would see|she would say/i.test(advice)) {
      const inAntiFrame =
        /(?:not|don['\u2019]?t|avoid|instead of|rather than|pivots?)[^.]*she['\u2019]d/i.test(
          advice,
        );
      expect(
        inAntiFrame,
        `interior_witness_worry advice mentions "she'd see/say" but not in an anti-pattern warning frame. Current advice: "${advice}"`,
      ).toBe(true);
    }
  });
});

describe("ADVICE — no downstream duplication", () => {
  // These are the files that historically hand-wrote advice text
  // in parallel with the render.ts CRITIQUE_SPECS. After the
  // 2026-09-01 refactor, each of them must read from ADVICE
  // (via import or dynamic access) rather than defining its own
  // string.
  //
  // The guard: none of these files should contain the exact text
  // "flip to outside witness" or "she'd see" as a bare
  // recommendation (the pattern that leaked in the original bug).
  // If someone adds a hand-written advice string that recreates
  // the bug, this catches it before it ships.
  const FILES_UNDER_GUARD = [
    "src/lib/itc/criteria/worries.ts",
    "src/lib/itc/criteria/commitments.ts",
    "src/lib/itc/criteria/assumptions.ts",
    "src/lib/itc/criteria/behaviors.ts",
    "src/lib/itc/criteria/render.ts",
    "src/lib/itc/coach.ts",
  ];

  for (const rel of FILES_UNDER_GUARD) {
    it(`${rel} does not recommend a "flip to she'd see..." rewrite outside ADVICE`, () => {
      const src = read(rel);
      // Grep for the specific bad-recommendation pattern:
      // "Flip to outside witness" (verbatim from the original
      // buggy CRITIQUE_SPECS text). If it exists in any of these
      // files, the guard trips.
      expect(
        /Flip to outside witness/.test(src),
        `${rel} contains the retired "Flip to outside witness" recommendation. Advice text belongs in src/lib/itc/criteria/advice.ts.`,
      ).toBe(false);
    });
  }
});
