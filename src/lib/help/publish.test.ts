import { describe, expect, it } from "vitest";
import { lintSections } from "../../../scripts/help/voice-lint";
import { firstCleanDraft, publishedColumns, withHyphens } from "./publish";

const clean = (d: { lint: boolean }) => d.lint;

describe("firstCleanDraft", () => {
  it("returns the first draft that passes the voice lint", async () => {
    const drafts = [{ lint: false, n: 1 }, { lint: true, n: 2 }, { lint: true, n: 3 }];
    let i = 0;
    const out = await firstCleanDraft(async () => drafts[i++], clean);
    expect(out).toEqual({ ok: true, draft: { lint: true, n: 2 }, attempts: 2 });
  });

  it("counts a thrown attempt as a try and keeps going", async () => {
    let i = 0;
    const out = await firstCleanDraft(async () => {
      if (i++ === 0) throw new Error("response did not match schema");
      return { lint: true };
    }, clean);
    expect(out).toMatchObject({ ok: true, attempts: 2 });
  });

  it("gives up after three tries without returning a draft", async () => {
    let calls = 0;
    const out = await firstCleanDraft(async () => {
      calls++;
      return { lint: false };
    }, clean);
    expect(calls).toBe(3);
    expect(out).toEqual({ ok: false, reason: "failed the voice check (3 tries)", attempts: 3 });
  });
});

describe("publishedColumns", () => {
  it("marks the row live with no reviewer", () => {
    const now = new Date("2026-10-16T06:15:00Z");
    expect(publishedColumns(now)).toEqual({
      voice_lint_passed: true,
      reviewed: true,
      reviewed_by: null,
      reviewed_at: "2026-10-16T06:15:00.000Z",
      generated_at: "2026-10-16T06:15:00.000Z",
    });
  });
});

describe("withHyphens", () => {
  it("turns en dashes into hyphens so the draft passes, and leaves em dashes to fail", () => {
    const draft = {
      title: "Rate 1–10",
      sections: [{ what_its_for: "Score each area 1 – 10.", steps: ["Tap **NEXT** — then save."] }],
    };
    expect(lintSections(draft.sections).hits.map((h) => h.rule)).toContain("punct.en_dash");
    const fixed = withHyphens(draft);
    expect(fixed.title).toBe("Rate 1-10");
    expect(fixed.sections[0].what_its_for).toBe("Score each area 1-10.");
    expect(lintSections(fixed.sections).hits.map((h) => h.rule)).toEqual(["punct.em_dash"]);
  });
});
