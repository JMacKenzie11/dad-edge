/**
 * Clear the testability coaching left on assumption rows.
 *
 * checkAssumptionEnactable was turned off in 1cc101b, so the flag no
 * longer fires. That stops NEW boxes; it does nothing about the ones
 * already written. Coach text is persisted on the row
 * (itc_assumptions.sharpen_text) and only rewritten when that row is
 * saved or audited, so a man who is past the assumptions stage keeps
 * reading advice the app no longer stands behind and cannot clear.
 *
 * This is the third time stored coach text has outlived the logic
 * that wrote it (the coverage note on commitment rows, the column
 * review pointing at a row that no longer had a box, and now this).
 * Hence a script rather than another one-off.
 *
 * A row's sharpen_text is the finding lines joined with a space
 * (renderRowSharpen), so a row can carry this note ALONGSIDE real
 * coaching about its depth. Only the testability sentence is removed;
 * whatever else was on the row stays. When it was the only line, the
 * box is cleared, and its suggested_fix goes with it because that
 * rewrite was produced to answer this finding.
 *
 *   npx tsx scripts/itc-clear-testability-notes.ts          # report
 *   npx tsx scripts/itc-clear-testability-notes.ts --apply  # write
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** Every wording this advice has shipped under. Both are matched, so
 *  rows written before the 2026-09-03 rewording are caught too. */
const TESTABILITY_LINES = [
  'The "if" isn\'t a move you could make yourself this week. Start it with you doing the opposite of one of your behaviors, so you can test it.',
  "There's nothing here you could put to the test this week. Name something you could actually do differently, so you can find out whether the belief holds.",
  "Nothing here could show you whether this is true. What would you have to see, hear, or try before you'd doubt it?",
];

function strip(text: string): string {
  let out = text;
  for (const line of TESTABILITY_LINES) out = out.split(line).join(" ");
  return out.replace(/\s+/g, " ").trim();
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_assumptions")
    .select("id, map_id, text, sharpen_text, suggested_fix")
    .not("sharpen_text", "is", null);
  if (error) throw new Error(error.message);

  let cleared = 0;
  let trimmed = 0;
  for (const row of data ?? []) {
    const current = String(row.sharpen_text);
    if (!TESTABILITY_LINES.some((l) => current.includes(l))) continue;
    const remainder = strip(current);
    const patch =
      remainder.length === 0
        ? { sharpen_text: null, suggested_fix: null }
        : { sharpen_text: remainder };
    console.log(`\n${row.id}  (map ${row.map_id})`);
    console.log(`  assumption: ${String(row.text).slice(0, 70)}`);
    console.log(`  was: ${current.slice(0, 100)}`);
    console.log(
      `  now: ${remainder.length === 0 ? "(box cleared, rewrite cleared)" : remainder.slice(0, 100)}`,
    );
    if (remainder.length === 0) cleared += 1;
    else trimmed += 1;
    if (apply) {
      const { error: uErr } = await supabase
        .from("itc_assumptions")
        .update(patch)
        .eq("id", row.id);
      if (uErr) console.log(`  ERROR: ${uErr.message}`);
    }
  }
  console.log(
    `\n${apply ? "applied" : "dry run"}: ${cleared} box(es) cleared, ${trimmed} trimmed to their remaining coaching`,
  );
  if (!apply && cleared + trimmed > 0) console.log("re-run with --apply to write");
}

main();
