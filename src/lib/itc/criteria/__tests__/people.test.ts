import { describe, expect, it } from "vitest";
import { checkPeopleFromMap, witnessFromMap } from "../people";

const AMPLIFY_MAP = [
  "I'm committed to getting better at staying grounded in service and trusting myself, especially when the stakes feel high.",
  "I launch into why my approach is right before I've actually listened to what the other person sees.",
];

const BOND_MAP = [
  "I'm committed to getting better at staying in the room when my wife brings up something hard.",
  "I bring up things she did in the past instead of listening to her.",
];

describe("checkPeopleFromMap", () => {
  it("refuses a 'she' the map never mentions and names who the map does have", () => {
    const v = checkPeopleFromMap({
      draftText: "I worry that if I listened first without pitching, she'd see I've never actually cared what she thinks.",
      mapTexts: AMPLIFY_MAP,
    });
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual(["she"]);
    expect(v.reason).toMatch(/never mentions "she"/);
    expect(v.reason).toMatch(/names no one in particular/);
  });

  it("accepts 'they' / 'the other person' on a map that names no one", () => {
    const v = checkPeopleFromMap({
      draftText: "I worry that if I listened first, they'd see I've never cared what the other person thinks.",
      mapTexts: AMPLIFY_MAP,
    });
    expect(v.ok).toBe(true);
  });

  it("accepts 'she' / 'her' on a map that has a wife", () => {
    const v = checkPeopleFromMap({
      draftText: "I worry that if I let her past rest, she'd see I've been the husband who dodges his own mistakes.",
      mapTexts: BOND_MAP,
    });
    expect(v.ok).toBe(true);
    expect(v.onMap).toContain("she/her");
    expect(v.onMap).toContain("wife");
  });

  it("refuses relational nouns the map doesn't have, even on a gendered map", () => {
    const v = checkPeopleFromMap({
      draftText: "I worry that if I stayed, my kids would see I'm the dad who walks out.",
      mapTexts: BOND_MAP,
    });
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual(["kids"]);
    expect(v.reason).toMatch(/The people on this map: she\/her, wife/);
  });

  it("never holds the man's own role or his own pronouns to the map", () => {
    const v = checkPeopleFromMap({
      draftText: "I worry that if I let them finish, they'd see I've been the coach who makes up his mind before he hears them.",
      mapTexts: AMPLIFY_MAP,
    });
    expect(v.ok).toBe(true);
  });

  it("only possessed relational nouns count as people ('my kids' yes, 'the father who' no)", () => {
    expect(
      checkPeopleFromMap({
        draftText: "I worry that if I stayed calm, they'd see I've been the father who checks out.",
        mapTexts: AMPLIFY_MAP,
      }).ok,
    ).toBe(true);
    const v = checkPeopleFromMap({
      draftText: "I worry that if I stayed calm, my kids would see I've been checked out.",
      mapTexts: AMPLIFY_MAP,
    });
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual(["kids"]);
  });

  it("catches a contracted pronoun with no bare form anywhere", () => {
    // The hole that shipped a phantom she (2026-09-02): the auto
    // derived commitment "...not worth what she's charging" on a map
    // that names no woman. words() tokenized "she's" whole, so
    // has("she") was false and the draft passed. Note this sentence
    // contains NO bare "she" — the older tests that looked like they
    // covered this each had one elsewhere in the string and so passed
    // for the wrong reason.
    const v = checkPeopleFromMap({
      draftText:
        "I'm also committed to never being the consultant clients see as not worth what she's charging.",
      mapTexts: AMPLIFY_MAP,
    });
    expect(v.ok).toBe(false);
    expect(v.offenders).toContain("she");
  });

  it("catches every contracted form, not just the possessive", () => {
    for (const frag of ["she's charging", "she'd walk", "she'll say so"]) {
      const v = checkPeopleFromMap({
        draftText: `I'm committed to never being the guy ${frag}.`,
        mapTexts: AMPLIFY_MAP,
      });
      expect(v.ok, `"${frag}" slipped through`).toBe(false);
    }
  });

  it("a contraction still passes when the map does have her", () => {
    const v = checkPeopleFromMap({
      draftText: "I worry that if I let her past rest, she'd see I've been dodging.",
      mapTexts: BOND_MAP,
    });
    expect(v.ok).toBe(true);
  });

  it("splitting on the apostrophe doesn't invent offenders", () => {
    // "don't" -> "don", "I've" -> "i". Neither is a pronoun or a
    // relational noun, so the extra stems have to stay inert.
    const v = checkPeopleFromMap({
      draftText: "I don't ask what they need, and I've never said so out loud.",
      mapTexts: AMPLIFY_MAP,
    });
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("fails open with no map text", () => {
    expect(checkPeopleFromMap({ draftText: "she'd see", mapTexts: [] }).ok).toBe(true);
  });

  it("matches whole words only (the 'her' in 'other' or 'there' doesn't count)", () => {
    const v = checkPeopleFromMap({
      draftText: "I worry that if I let the other person finish, there'd be nothing left of my case.",
      mapTexts: AMPLIFY_MAP,
    });
    expect(v.ok).toBe(true);
  });
});

describe("witnessFromMap", () => {
  it("picks she for a map with a wife, they for a map with no one", () => {
    expect(witnessFromMap(BOND_MAP)).toEqual({ subject: "she", would: "she'd", object: "her" });
    expect(witnessFromMap(AMPLIFY_MAP)).toEqual({ subject: "they", would: "they'd", object: "them" });
  });

  it("falls back to they when the map has both", () => {
    expect(witnessFromMap(["my wife and my son"]).subject).toBe("they");
  });
});
