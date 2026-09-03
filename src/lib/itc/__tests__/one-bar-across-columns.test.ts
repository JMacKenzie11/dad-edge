/**
 * The same fear, judged once.
 *
 * A worry passed the inline coach at 3/3 and the competing commitment
 * mirroring it word for word scored 1/3 (2026-09-03):
 *
 *   worry:      "...they'd think I'm not skilled enough to deliver
 *                exceptional results."          -> 3/3
 *   commitment: "I'm also committed to never being seen as not
 *                skilled enough to deliver exceptional results" -> 1/3
 *
 * Two faults, both structural rather than a wording accident.
 *
 * 1. A double negative. The vow is BUILT by mirroring the worry, so
 *    when the worry's identity is itself a negation the mirror stacks
 *    two of them ("never being seen as NOT skilled enough"). The
 *    judge read that as a positive aspiration and told him he had
 *    written a Column 1 goal. He had written a correct vow; the
 *    reading inverted his map.
 *
 * 2. Two judges for one question. Criterion 3 re-judged whether the
 *    identity was specific enough, but that identity is the worry's
 *    own words, already ruled on by scoreWorryDepth.touches_identity
 *    one column upstream. When the mirror is faithful, re-judging can
 *    only produce the coach approving a fear and then rejecting the
 *    vow that carries it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const rubric = readFileSync(resolve(here, "..", "rubric.ts"), "utf8");

describe("the commitment rubric reads a mirrored negation correctly", () => {
  it("warns the judge that a stacked negation is still a negative vow", () => {
    expect(rubric).toMatch(/WATCH THE DOUBLE NEGATIVE/);
    expect(rubric).toMatch(/never being seen as NOT skilled enough/);
  });

  it("says plainly that such a vow is not a commitment to the opposite", () => {
    // The exact inversion that shipped: "you're committed to being
    // seen as skilled, which is a goal, not a competing commitment".
    expect(rubric).toMatch(/it is NOT a commitment to being seen as skilled/);
  });
});

describe("the identity is judged in Column 3 and not re-judged in Column 4", () => {
  it("criterion 3 defers to the mirror rather than re-scoring the identity", () => {
    expect(rubric).toMatch(/IF criterion 2 IS TRUE, THIS ONE IS TRUE TOO/);
    expect(rubric).toMatch(/Do not fail this because the worry's identity is broad/);
    expect(rubric).toMatch(/That is Column 3's call and it has been made/);
  });

  it("still asks whether the vow DROPPED his specifics, which is its real job", () => {
    // The criterion has to keep catching a vow that generalizes away
    // from the worry ("never failing"). Losing that would be
    // over-correcting into the opposite bug.
    expect(rubric).toMatch(/whether the vow DROPPED his specifics/);
    expect(rubric).toMatch(/unless the vow generalizes away from the worry/);
  });
});
