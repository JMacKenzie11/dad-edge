import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LARRY_PLAYBOOK, LARRY_VOICE, MAIN_COACH_VOICE } from "./voice-rules";
import { systemBase } from "./prompts";

/**
 * The Coach Larry chat speaks as Larry (DECISIONS.md "Coach Larry speaks
 * as Larry"). These pin what it's built from, and the two rules Jason
 * set that the prompt text itself has to model: no slang words, no
 * em-dashes (the model copies what its instructions do).
 */

const SLANG = /\b(freakin[g']?|frickin[g']?|friggin[g']?|dang|darn|damn|crap|pissed|shit\w*|fuck\w*|sucks?)\b/i;

describe("Coach Larry voice bundle", () => {
  it("is Larry's voice guide and playbook, not the shared coach voice doc", () => {
    expect(MAIN_COACH_VOICE).toContain("You are Larry Hagner");
    expect(MAIN_COACH_VOICE).toContain("## Stories you tell");
    const shared = readFileSync("docs/coach-voice-and-tone.md", "utf8");
    expect(MAIN_COACH_VOICE).not.toContain(shared.split("\n")[0]);
    for (const mode of ["general", "mission"] as const) {
      expect(systemBase(mode)).toContain("You are Larry Hagner");
      expect(systemBase(mode)).not.toContain("# Coach Voice, Language, and Tone");
    }
  });

  it("has no slang outside the line that bans it", () => {
    const lines = `${LARRY_VOICE}\n${LARRY_PLAYBOOK}`.split("\n").filter((l) => !l.includes("No slang words at all"));
    expect(lines.filter((l) => SLANG.test(l))).toEqual([]);
  });

  it("has no em-dashes or en-dashes in anything the model reads", () => {
    for (const mode of ["general", "mission"] as const) {
      expect(systemBase(mode).match(/.{0,30}[—–].{0,30}/g) ?? []).toEqual([]);
    }
  });

  it("keeps the honesty rule: he's told it's an AI if he asks", () => {
    expect(LARRY_VOICE).toMatch(/If he asks whether you're really Larry, a person, or an AI, tell him the truth/);
  });
});
