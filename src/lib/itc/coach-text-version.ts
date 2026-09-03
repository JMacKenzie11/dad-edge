/**
 * Version stamp for coach text written onto map rows.
 *
 * THE PROBLEM THIS SOLVES. Coach text (sharpen_text, suggested_fix,
 * rubric_reason) is computed once and persisted on the row. It is
 * rewritten only when that row is saved or audited. So when a check
 * changes, or its advice is reworded, or a finding stops firing
 * altogether, every box already written keeps saying the old thing,
 * forever, on any row the coachee has moved past.
 *
 * That happened three times in one day (2026-09-03) and each time a
 * human noticed before the system did:
 *
 *   - the coverage note stopped writing to commitment rows, and the
 *     rows kept showing it (migration 20260903000001)
 *   - the column review stopped pointing at rows for findings with no
 *     row box, and stored reviews kept pointing
 *   - the testability check was turned off, and the boxes it had
 *     written stayed up (scripts/itc-clear-testability-notes.ts)
 *
 * Each needed a hand-written cleanup that had to know the exact
 * wording it was hunting. Miss one and a coachee reads advice the app
 * no longer stands behind.
 *
 * THE FIX. Every row that carries coach text also carries the version
 * of the criteria that produced it. On read, text stamped with an
 * older version is treated as absent: not shown, not counted, and
 * regenerated the next time that row is scored. Nothing to sweep, no
 * wording to match, and it cannot miss a row.
 *
 * WHEN TO BUMP. Any change to what the coach would say: a check's
 * verdict, an advice string, how findings render into a row box, a
 * rubric's criteria. There is a test that hashes those files and
 * fails if they change without a bump, so this is not a thing you can
 * forget (see coach-text-version.test.ts).
 *
 * The cost of bumping unnecessarily is one regeneration per row on
 * next save or audit. The cost of NOT bumping is a coachee reading
 * something the app would no longer say. Bump when unsure.
 */
export const COACH_TEXT_VERSION = 1;

/**
 * Files whose content determines what the coach text says. The drift
 * test hashes exactly these; adding a new check module means adding
 * it here, or its changes will not force a bump.
 *
 * Paths are relative to the repo root.
 */
export const COACH_TEXT_SOURCES = [
  "src/lib/itc/criteria/advice.ts",
  "src/lib/itc/criteria/assumptions.ts",
  "src/lib/itc/criteria/behaviors.ts",
  "src/lib/itc/criteria/commitments.ts",
  "src/lib/itc/criteria/goal.ts",
  "src/lib/itc/criteria/worries.ts",
  "src/lib/itc/criteria/people.ts",
  "src/lib/itc/criteria/render.ts",
  "src/lib/itc/criteria/row-sharpen.ts",
  "src/lib/itc/criteria/orchestrator.ts",
  "src/lib/itc/criteria/types.ts",
  "src/lib/itc/rubric.ts",
] as const;

/**
 * Is coach text stamped with this version still current?
 *
 * Three cases, and the difference between the last two is what makes
 * this safe to deploy before the migration runs:
 *
 *   number === COACH_TEXT_VERSION  current. Show it.
 *   null                           the column exists and this row has
 *                                  no stamp, so the text predates the
 *                                  mechanism. Stale; regenerate.
 *   undefined                      the column does not exist yet, i.e.
 *                                  the migration has not run. Treat as
 *                                  current, because the alternative is
 *                                  every coach box on every map
 *                                  disappearing the moment this code
 *                                  ships and before the SQL is
 *                                  applied. Fail open: a stale box is
 *                                  a bad sentence, an empty column is
 *                                  a broken product.
 */
export function coachTextIsCurrent(version: number | null | undefined): boolean {
  if (version === undefined) return true;
  return version === COACH_TEXT_VERSION;
}
