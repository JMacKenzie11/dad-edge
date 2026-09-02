/**
 * Guards on the Big Assumption bar, both drifting halves of it.
 *
 * Kegan & Lahey Vol 1 p 19 runs a quiz of twelve assumptions and
 * answers it: "items 6, 7 and 10 are not yet testable." Everything
 * else passes, including three that carry no "if" and no "then" at
 * all (1, 2, 9), and Appendix D lists worked tests for each. Item 7,
 * "If I were to fail, I would lose all my self-respect", is a clean
 * if-then landing on identity and they reject it. So if-then shape
 * is not the bar.
 *
 * scoreAssumptionDepth used to require it anyway, which scored the
 * guides' own Big Assumptions 0-1/3 while the stage intro shipped
 * copy saying if-then was usual "though not always". One judge, one
 * answer: these tests hold the prompt and the copy to the same rule.
 *
 * If these fail, do not loosen the test — fix the prompt or the copy.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { depthSeverity } from "../criteria/types";
import { ASSUMPTION_EXAMPLES, WORRY_EXAMPLES } from "../guide-examples";
import { worryPassesDepth } from "../rules";

const here = dirname(fileURLToPath(import.meta.url));
const rubricSource = readFileSync(resolve(here, "..", "rubric.ts"), "utf8");

/** The three flat, non-if-then Big Assumptions the guide passes. */
const GUIDE_FLAT_ASSUMPTIONS = [
  "I don't believe I can ever be skillful at managing my anger",
  "My self-worth is based on how others view me",
  "I need to feel overfull in order to feel full enough",
];

describe("assumption rubric prompt", () => {
  it("does not define a Big Assumption as requiring if-then form", () => {
    // The old header: "a first-person belief in if-then form whose
    // 'then' lands somewhere genuinely bad". That single clause is
    // what drove the model to fail every flat belief.
    expect(rubricSource).not.toMatch(/Big Assumption is a first-person belief in if-then form/);
  });

  it("tells the model in so many words that a flat belief passes", () => {
    expect(rubricSource).toMatch(/Do not ask them for an "if"/);
    expect(rubricSource).toMatch(/Do not reject them for lacking a "then"/);
  });

  it("carries the guide's own flat examples so the model has them by name", () => {
    // At least two of the three, quoted in the prompt. Verbatim
    // examples are what stopped the model reading "flat belief" as
    // "vague belief" and failing them anyway.
    const present = GUIDE_FLAT_ASSUMPTIONS.filter((a) =>
      rubricSource.includes(a.replace(/^I don't/, "I don't")),
    );
    expect(present.length).toBeGreaterThanOrEqual(2);
  });

  it("still rejects a forecast, which is the thing the criterion is for", () => {
    expect(rubricSource).toMatch(/the money might not show up.*FAILS|FAILS.*stops at an event/s);
  });

  it("exempts a flat belief from the backwards-direction check", () => {
    // A belief that names no act has no direction to get backwards.
    // Without the third enum option the model had to answer a
    // question the assumption never asked, and a false reading
    // silently zeroed the identity criterion.
    expect(rubricSource).toMatch(/"no act is named"/);
    expect(rubricSource).toMatch(
      /which_produces_the_consequent !== "the opposite of that act"/,
    );
  });
});

describe("the stage intro and the rubric agree on shape", () => {
  it("intro copy does not promise if-then is required", () => {
    const intro = readFileSync(resolve(here, "..", "stage-intros.ts"), "utf8");
    // Copy shipped 2026-09-01 says if-then is common "though not
    // always". The rubric must not contradict it.
    const claimsRequired = /must be written as "?I assume that if/i.test(intro);
    expect(claimsRequired).toBe(false);
  });
});

describe("depth badge severity", () => {
  it("separates a 2 from a 0, because the guides do", () => {
    expect(depthSeverity(0)).toBe("critical");
    expect(depthSeverity(1)).toBe("critical");
    expect(depthSeverity(2)).toBe("moderate");
  });

  it("a 2 clears the gate on the second attempt, so it is not a wall", () => {
    expect(worryPassesDepth(2, 1)).toBe(false);
    expect(worryPassesDepth(2, 2)).toBe(true);
    expect(worryPassesDepth(1, 5)).toBe(false);
  });
});

describe("the assumption box shows the stem it is going to save", () => {
  const rowSource = readFileSync(
    resolve(here, "..", "..", "..", "app", "itc", "[mapId]", "assumptions-row.tsx"),
    "utf8",
  );
  /** The file with comments removed. The comments deliberately quote
   *  the retired opening in order to explain how the seeded stem
   *  differs from it, so a naive match on the whole file finds the
   *  very explanation that documents its absence. */
  const rowCode = rowSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("seeds the add box from ASSUMPTION_STEM, not a hand-typed copy", () => {
    // saveAssumption prepends the stem via ensureStem either way. The
    // box shows it so he can see the sentence he is writing instead
    // of meeting it after the save. Reading the constant rather than
    // retyping the words keeps the two from drifting apart.
    expect(rowSource).toMatch(/import \{ ASSUMPTION_STEM \} from "@\/lib\/itc\/stage"/);
    expect(rowSource).toMatch(/const SEED = `\$\{ASSUMPTION_STEM\} `/);
    expect(rowSource).not.toMatch(/useState\("I assume/);
  });

  it("does not accept the stem on its own as an assumption", () => {
    // A bare length check would pass "I assume that" on character
    // count alone.
    expect(rowSource).toMatch(/beyondStem/);
    expect(rowSource).not.toMatch(/if \(trimmed\.length < 3\)/);
  });

  it("seeds a STEM and not the content-bearing opening that was removed", () => {
    // The retired opening was "I assume that if I <act>, ", built
    // from his own commitment, and men finished it by restating the
    // worry one column up. A stem carries no content.
    //
    expect(rowCode).not.toMatch(/I assume that if I/);
  });
});

describe("the reason and the rewrite don't compete", () => {
  it("no rubric asks its reason to write a replacement entry", () => {
    // Observed 2026-09-02: a commitment's coach text ended with a
    // full rewrite ("...so the commitment should mirror that: I'm
    // also committed to never being the guy who folds under pressure
    // and looks weak to clients") while the Sharper box beneath it
    // offered a DIFFERENT sentence. Two rewrites on one screen reads
    // as the coach arguing with itself.
    expect(rubricSource).not.toMatch(/what the finished version would say/);
    expect(rubricSource).toMatch(/Do NOT write out a replacement entry/);
  });
});

describe("guide examples", () => {
  it("every pair carries the citation that makes it checkable", () => {
    // These are quoted from the guides, not written by us. The
    // citation is what lets a coachee (or the next maintainer) go
    // verify a line rather than trust it.
    for (const p of [...WORRY_EXAMPLES, ...ASSUMPTION_EXAMPLES]) {
      expect(p.source, `missing source: ${p.to}`).toMatch(/Coach's Guide Vol [12] p \d+/);
      expect(p.from.length).toBeGreaterThan(10);
      expect(p.to.length).toBeGreaterThan(10);
    }
  });

  it("every example opens with the prefix its own box uses", () => {
    // The guides write Column 3 as a fear box of fragments ("Being a
    // jerk, selfish..."), not sentences. Shown that way, a man copies
    // the shape he sees and the coach then flags it: the example
    // would teach the wrong thing and the judge would punish him for
    // learning it. So the worries carry the guides' fear words in
    // this app's sentence form. Assumptions needed no change.
    for (const p of WORRY_EXAMPLES) {
      expect(p.to, `worry example must open "I worry that": ${p.to}`).toMatch(
        /^I worry that\b/,
      );
    }
    for (const p of ASSUMPTION_EXAMPLES) {
      expect(
        p.to,
        `assumption example must open "I assume that": ${p.to}`,
      ).toMatch(/^I assume that\b/);
    }
  });

  it("keeps a flat, non-if-then Big Assumption among the examples", () => {
    // Showing only if-thens would teach the requirement we removed
    // from the rubric. Vol 1 p 4 asks that at least one assumption on
    // a map be if-then, not every one.
    const flat = ASSUMPTION_EXAMPLES.filter(
      (p) => !/^I assume that if\b/i.test(p.to),
    );
    expect(
      flat.length,
      "at least one assumption example must be a flat belief, not an if-then",
    ).toBeGreaterThanOrEqual(1);
  });

  it("keeps an if-then one too, since the guides lead with that shape", () => {
    expect(
      ASSUMPTION_EXAMPLES.filter((p) => /^I assume that if\b/i.test(p.to))
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("stays short enough to be a thought jogger", () => {
    // The panel is collapsed by default; the pairs still have to read
    // as a line or two, not a page. Longer spans are trimmed with an
    // ellipsis rather than reworded.
    for (const p of [...WORRY_EXAMPLES, ...ASSUMPTION_EXAMPLES]) {
      expect(p.from.length, `too long, trim it: ${p.from}`).toBeLessThan(160);
      expect(p.to.length, `too long, trim it: ${p.to}`).toBeLessThan(200);
    }
  });
});

describe("coach prose obeys the interior-witness ban it enforces", () => {
  it("scrubs 'have to face' out of its own reasons", async () => {
    const { scrubBannedCoachWords } = await import("../coach");
    const out = scrubBannedCoachWords(
      "The finished version would say who you'd be, the identity you'd have to face about yourself.",
    );
    expect(out).not.toMatch(/have to face/i);
    expect(out).toMatch(/would be seen as/i);
  });

  it("scrubs the rest of the family", async () => {
    const { scrubBannedCoachWords } = await import("../coach");
    for (const bad of ["have to admit", "have to confront", "have to reckon with"]) {
      expect(scrubBannedCoachWords(`You'd ${bad} being the guy who folds.`)).not.toMatch(
        new RegExp(bad, "i"),
      );
    }
  });
});
