/**
 * One judge, ONE evidence set.
 *
 * checkPeopleFromMap refuses a draft that introduces a person the map
 * never names. It was right; what it was shown was not. Every
 * save-time caller in fixes.ts omitted `mapTexts` while every
 * hone-time caller passed it, and reviseBehavior / reviseAssumption
 * had no such parameter at all. So on a map whose WORRY names a wife
 * but whose goal and behavior don't, the save-time rewrite was
 * refused for adding "she" while the hone-time rewrite of the
 * identical finding was accepted: no "Use this" on the row, a "Use
 * this" in the banner, same coachee, same sentence.
 *
 * The fix is the type, not a convention: `mapTexts` is required on
 * every drafter and reviser, so a blind call site is a compile error
 * rather than a bug that shows up on someone's map. These tests keep
 * it that way.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");
const coach = read("coach.ts");
const fixes = read("fixes.ts");

describe("mapTexts is required, not optional", () => {
  it("no drafter declares mapTexts optional", () => {
    // `mapTexts?: string[]` is how this bug existed for months: the
    // callers that forgot it still compiled.
    expect(coach).not.toMatch(/mapTexts\?\s*:/);
    expect(fixes).not.toMatch(/mapTexts\?\s*:/);
  });

  it("every drafter and reviser that emits coachee-facing text takes it", () => {
    for (const fn of [
      "draftWorryOutcome",
      "draftCommitmentOutcome",
      "reviseBehavior",
      "reviseAssumption",
    ]) {
      const at = coach.indexOf(`export async function ${fn}(input: {`);
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      const sig = coach.slice(at, coach.indexOf("}): Promise", at));
      expect(sig, `${fn} must take mapTexts`).toMatch(/mapTexts: string\[\]/);
    }
  });

  it("nobody silences the type with an empty array", () => {
    // `mapTexts: []` type-checks and reintroduces the exact bug.
    for (const [name, src] of [
      ["coach.ts", coach],
      ["fixes.ts", fixes],
      ["actions.ts", read("../../app/itc/actions.ts")],
    ] as const) {
      expect(src, `${name} passes an empty evidence set`).not.toMatch(
        /mapTexts:\s*\[\s*\]/,
      );
    }
  });

  it("the two definitions of 'the map's text' draw on the same columns", () => {
    // loadMapTexts (save-time, loads from the db) and mapTextsOf
    // (hone-time, reads the loaded context) must not drift apart.
    // They live next to each other in fixes.ts for this reason.
    const load = fixes.slice(
      fixes.indexOf("export async function loadMapTexts"),
      fixes.indexOf("function mapTextsOf"),
    );
    const ofCtx = fixes.slice(
      fixes.indexOf("function mapTextsOf"),
      fixes.indexOf("function linkedCommitmentsFor"),
    );
    for (const column of ["behaviors", "worries", "commitments", "assumptions"]) {
      expect(load, `loadMapTexts drops ${column}`).toMatch(new RegExp(column));
      expect(ofCtx, `mapTextsOf drops ${column}`).toMatch(new RegExp(column));
    }
  });
});

describe("the depth bar is one constant", () => {
  it("coach.ts compares against DEPTH_THRESHOLD, never a bare 3", () => {
    // Nine hardcoded 3s meant changing the constant would move the
    // gate for the judges and silently leave every drafter behind.
    expect(coach).not.toMatch(/\.score\s*(>=|<)\s*3\b/);
    expect(coach).toMatch(/DEPTH_THRESHOLD/);
  });
});

describe("RE-DERIVE is gone", () => {
  it("no action, no button, no banner", () => {
    const actions = read("../../app/itc/actions.ts");
    const row = read("../../app/itc/[mapId]/assumptions-row.tsx");
    expect(actions).not.toMatch(/export async function redriveAssumptionFromCommitment/);
    expect(row).not.toMatch(/redriveAssumptionFromCommitment/);
    expect(row).not.toMatch(/StaleUpstreamBanner/);
    // The button promised a re-derive and never called a drafter.
    expect(row).not.toMatch(/RE-DERIVE/);
  });
});
