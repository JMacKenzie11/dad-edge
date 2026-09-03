/**
 * The bump you cannot forget.
 *
 * COACH_TEXT_VERSION only works if it goes up when the criteria
 * change. Relying on remembering is what produced the problem it
 * exists to solve, so this test hashes the files that determine what
 * the coach says and fails when they move without a bump.
 *
 * WHEN THIS FAILS, you changed a check, an advice string, a rubric or
 * a renderer. Decide:
 *
 *   - Would a coachee's existing box now say something different, or
 *     something the app would no longer say? Bump COACH_TEXT_VERSION
 *     in coach-text-version.ts, then paste the hash below.
 *   - Purely internal (a comment, a rename, a refactor with identical
 *     output)? Paste the hash below and leave the version alone.
 *
 * Bumping unnecessarily costs one regeneration per row on the next
 * save or audit. Not bumping costs a coachee reading something stale
 * with no way to clear it. When unsure, bump.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COACH_TEXT_SOURCES,
  COACH_TEXT_VERSION,
  coachTextIsCurrent,
} from "../coach-text-version";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");

/** Hash of COACH_TEXT_SOURCES at COACH_TEXT_VERSION = 1. */
const RECORDED_HASH = "17d25f50bdcfc6165676fafd97bd04127cea067c74054254927e6d6d9c911bd8";

function hashSources(): string {
  const h = createHash("sha256");
  for (const rel of COACH_TEXT_SOURCES) {
    h.update(rel);
    h.update(readFileSync(resolve(repoRoot, rel), "utf8"));
  }
  return h.digest("hex");
}

describe("coach text version", () => {
  it("the criteria have not changed without a bump", () => {
    expect(
      hashSources(),
      `The files that decide what the coach says have changed. If a coachee's existing box would now read differently, bump COACH_TEXT_VERSION (currently ${COACH_TEXT_VERSION}) in src/lib/itc/coach-text-version.ts. Either way, update RECORDED_HASH in this file to the value above. See the note at the top.`,
    ).toBe(RECORDED_HASH);
  });

  it("every listed source exists", () => {
    // A renamed or deleted file would otherwise throw inside the hash
    // with a stack trace instead of a readable failure.
    for (const rel of COACH_TEXT_SOURCES) {
      expect(() => readFileSync(resolve(repoRoot, rel), "utf8"), rel).not.toThrow();
    }
  });
});

describe("coachTextIsCurrent", () => {
  it("current stamp is current", () => {
    expect(coachTextIsCurrent(COACH_TEXT_VERSION)).toBe(true);
  });

  it("an older stamp is stale", () => {
    expect(coachTextIsCurrent(COACH_TEXT_VERSION - 1)).toBe(false);
  });

  it("null is stale: the column exists and this row predates the stamp", () => {
    expect(coachTextIsCurrent(null)).toBe(false);
  });

  it("undefined is CURRENT: the migration has not run yet", () => {
    // Fail open on purpose. Treating a missing column as stale would
    // empty every coach box on every map the moment this code ships
    // and before the SQL is applied. A stale box is a bad sentence;
    // an empty column is a broken product.
    expect(coachTextIsCurrent(undefined)).toBe(true);
  });
});
