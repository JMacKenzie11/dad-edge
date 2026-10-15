import { describe, expect, it } from "vitest";
import { decide, exemptionReason, isDocFile, isSourceFile } from "./check-docs-touched";

describe("decide", () => {
  it("passes when no source changed", () => {
    expect(decide({ files: ["scripts/seed.ts", "package.json", "src/app/globals.css"], body: "" })).toMatchObject({
      ok: true,
      reason: "no-source",
    });
  });

  it("passes when a doc changed alongside source", () => {
    for (const doc of ["docs/e2e.md", "CLAUDE.md", "README.md", "PRODUCT_SPEC.md", "DECISIONS.md"]) {
      expect(decide({ files: ["src/lib/pillars.ts", doc], body: "" })).toMatchObject({ ok: true, reason: "docs-updated" });
    }
  });

  it("passes with a Docs-exempt line that has a reason", () => {
    const body = "## What changed\nRenamed a helper.\n\nDocs-exempt: internal rename, no behaviour change\n";
    expect(decide({ files: ["src/lib/cn.ts"], body })).toMatchObject({ ok: true, reason: "exempt" });
  });

  it("fails on source with no docs and no exemption, listing the files and where things belong", () => {
    const d = decide({ files: ["src/lib/pillars.ts", "src/app/(app)/today/page.tsx", "src/lib/pillars.test.ts"], body: "Some body" });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.sourceFiles).toEqual(["src/lib/pillars.ts", "src/app/(app)/today/page.tsx"]);
      expect(d.detail).toMatch(/PRODUCT_SPEC\.md/);
      expect(d.detail).toMatch(/DECISIONS\.md/);
      expect(d.detail).toMatch(/help content/);
      expect(d.detail).toMatch(/Docs-exempt: <the reason>/);
    }
  });

  it("an empty or missing reason is not an exemption", () => {
    expect(decide({ files: ["src/lib/cn.ts"], body: "Docs-exempt:" }).ok).toBe(false);
    expect(decide({ files: ["src/lib/cn.ts"], body: "Docs-exempt:    \n" }).ok).toBe(false);
    expect(decide({ files: ["src/lib/cn.ts"], body: "We should add Docs-exempt: maybe" }).ok).toBe(false);
  });
});

describe("file classes", () => {
  it("source means src/ code files, not tests or CSS", () => {
    expect(isSourceFile("src/lib/pillars.ts")).toBe(true);
    expect(isSourceFile("src/app/page.tsx")).toBe(true);
    expect(isSourceFile("src/lib/pillars.test.ts")).toBe(false);
    expect(isSourceFile("src/app/globals.css")).toBe(false);
    expect(isSourceFile("scripts/seed.ts")).toBe(false);
    expect(isSourceFile("tests/coach/context.test.ts")).toBe(false);
  });

  it("docs are docs/, CLAUDE.md, README.md, PRODUCT_SPEC.md, DECISIONS.md", () => {
    expect(isDocFile("docs/vimeo-setup.md")).toBe(true);
    expect(isDocFile("PRODUCT_SPEC.md")).toBe(true);
    expect(isDocFile("src/docs/x.md")).toBe(false);
    expect(isDocFile("braveman-app-build-config.md")).toBe(false);
  });

  it("reads the reason off the exemption line", () => {
    expect(exemptionReason("a\nDocs-exempt: test-only fix\nb")).toBe("test-only fix");
    expect(exemptionReason("docs-exempt: lower case works too")).toBe("lower case works too");
  });
});
