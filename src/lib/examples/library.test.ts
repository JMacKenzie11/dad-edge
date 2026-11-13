import { describe, expect, it } from "vitest";
import { DOMAIN_PILLARS } from "@/lib/pillars";
import { validateMissionConcreteness } from "@/lib/validation/mission";
import { GOAL_EXAMPLES, MISSION_EXAMPLES, blanksIn, blanksMessage, firstBlankRange } from "./library";

const DAY_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow)\b/i;

describe("the example library", () => {
  const all = [...Object.values(MISSION_EXAMPLES), ...Object.values(GOAL_EXAMPLES)].flat();

  it("has fifteen missions and fifteen goals for every domain", () => {
    for (const p of DOMAIN_PILLARS) {
      expect(MISSION_EXAMPLES[p.code as keyof typeof MISSION_EXAMPLES]).toHaveLength(15);
      expect(GOAL_EXAMPLES[p.code as keyof typeof GOAL_EXAMPLES]).toHaveLength(15);
    }
  });

  it("gives every example its own id", () => {
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  it("keeps to the voice rules: no em-dashes, no banned words", () => {
    for (const e of all) {
      expect(e.text).not.toMatch(/—/);
      expect(e.text).not.toMatch(/\b(navigate|leverage|journey|really|very|sit with|sit in|lean into|great|amazing|deeply|truly|genuinely|intentional|mindful)\b/i);
    }
  });

  it("missions name no days: he picks the days on the row", () => {
    for (const e of Object.values(MISSION_EXAMPLES).flat()) expect(e.text).not.toMatch(DAY_WORDS);
  });

  it("missions fit the 280-character box and pass the save check once filled in", () => {
    for (const e of Object.values(MISSION_EXAMPLES).flat()) {
      expect(e.text.length).toBeLessThanOrEqual(280);
      const filled = e.text.replace(/\[[^\]]+\]/g, "Sam");
      expect(validateMissionConcreteness({ description: filled, target_date: "2026-11-13" }), e.text).toEqual({ ok: true });
    }
  });

  it("goals fit the 500-character box", () => {
    for (const e of Object.values(GOAL_EXAMPLES).flat()) expect(e.text.length).toBeLessThanOrEqual(500);
  });
});

describe("blanks", () => {
  it("finds every blank, in order", () => {
    expect(blanksIn("Have the conversation with [name] about [topic].")).toEqual(["[name]", "[topic]"]);
    expect(blanksIn("Take Lawson to breakfast.")).toEqual([]);
  });

  it("says what's left to fill in", () => {
    expect(blanksMessage(["[kid's name]"])).toBe("Fill in [kid's name] first.");
    expect(blanksMessage(["[name]", "[topic]"])).toBe("Fill in [name] and [topic] first.");
  });

  it("selects the first blank so he types over it", () => {
    const t = "Take [kid's name] to breakfast.";
    expect(firstBlankRange(t)).toEqual([5, 17]);
    expect(firstBlankRange(t)).toEqual([5, 17]);
    expect(firstBlankRange("No blanks.")).toBeNull();
  });
});
