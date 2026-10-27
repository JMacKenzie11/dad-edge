import { describe, expect, it } from "vitest";
import { checkReply } from "./coach-larry-compare";

describe("checkReply", () => {
  it("counts questions and words, and flags slang, dashes and Larry's own life", () => {
    const c = checkReply("So how's Kate? That's freaking hard — when Jess and I hit that, what did Mason do?");
    expect(c.questions).toBe(2);
    expect(c.words).toBe(17);
    expect(c.slang).toEqual(["freaking"]);
    expect(c.dashes).toBe(true);
    expect(c.larryLife).toEqual(["Jess", "Mason"]);
  });

  it("passes a clean reply", () => {
    expect(checkReply("Tell me more about that, brother. What did she say?")).toMatchObject({ slang: [], dashes: false, larryLife: [], business: [] });
  });

  it("flags a reply that assumes he runs a business", () => {
    expect(checkReply("Is this home, the business, or everything at once?").business).toEqual(["business"]);
    expect(checkReply("Is this home, work, or everything at once?").business).toEqual([]);
  });
});
