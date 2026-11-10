import { describe, expect, it } from "vitest";
import { answeredCount, finishBlocker, isAnswered } from "./progress";

const ids = ["a", "b", "c"];

describe("survey progress", () => {
  it("counts a question as answered only with a score and a note", () => {
    expect(isAnswered({ score: 4, note: "She said yes" })).toBe(true);
    expect(isAnswered({ score: 4, note: "   " })).toBe(false);
    expect(isAnswered({ score: null, note: "words" })).toBe(false);
    expect(isAnswered(undefined)).toBe(false);
  });

  it("counts answered questions in the set, ignoring strays", () => {
    expect(
      answeredCount(ids, [
        { question_id: "a", score: 3, note: "x" },
        { question_id: "b", score: 3, note: "" },
        { question_id: "zz", score: 5, note: "not in this set" },
      ]),
    ).toBe(1);
  });

  it("blocks finishing until every question has a score, then a note", () => {
    expect(finishBlocker(ids, [])).toBe("Score every question. Missing 3.");
    expect(
      finishBlocker(ids, [
        { question_id: "a", score: 1, note: "x" },
        { question_id: "b", score: 2, note: null },
        { question_id: "c", score: 5, note: " " },
      ]),
    ).toBe("Notes required for every question. Missing 2. Her words matter.");
    expect(
      finishBlocker(ids, ids.map((id) => ({ question_id: id, score: 3, note: "words" }))),
    ).toBeNull();
  });

  it("never lets an empty question set finish", () => {
    expect(finishBlocker([], [])).not.toBeNull();
  });
});
