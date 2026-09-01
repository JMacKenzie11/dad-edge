/**
 * One-shot backfill: re-score every itc_worries row against the current
 * scoreWorryDepth rubric, and update depth_score + rubric_reason where
 * the verdict changed.
 *
 * Why: the touches_identity criterion in scoreWorryDepth was tightened
 * (2026-09-01) to require an explicitly named identity noun, not just
 * a failure event or outcome. Existing worries were graded under the
 * looser bar; some that scored 3/3 would now score 2/3 (or lower).
 *
 * The audit reads the STORED depth_score. Without a re-score pass,
 * old passing-but-shallow worries stay silently misclassified and the
 * hone audit never flags them. This script closes that gap once.
 *
 * Only writes when (depth_score, rubric_reason) actually change — so
 * no-op re-scores don't trigger the itc_maps.hone_diagnostic_stale +
 * walkthrough_stale flags falsely. Worries that legitimately flip
 * from pass to fail DO trigger those flags, which is correct: the
 * coachee's next visit will see the "map has moved" banner and can
 * re-run the audit against the new bar.
 *
 * Runs the SAME composeWorrySharpen path saveWorry uses, so the
 * persisted rubric_reason includes both depth-rubric feedback and
 * any interior-witness regex finding — one source of truth.
 *
 * Usage:
 *
 *   npm run itc:rescore-worries               (dry run — prints deltas, no writes)
 *   npm run itc:rescore-worries -- --apply    (writes to DB)
 *
 * Idempotent: re-runs with no rubric change produce zero updates.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { composeWorrySharpen } from "@/lib/itc/criteria/row-sharpen";
import { scoreWorryDepth } from "@/lib/itc/rubric";
import type { ItcBehavior, ItcMap, ItcWorry } from "@/lib/itc/maps";

const APPLY = process.argv.includes("--apply");

type ScoreDelta = {
  worryId: string;
  mapId: string;
  worryText: string;
  before: { depth_score: number | null; rubric_reason: string | null };
  after: { depth_score: number; rubric_reason: string | null };
  changed: boolean;
};

async function main() {
  const supabase = createSupabaseServiceClient();

  console.log(APPLY ? "MODE: apply (writes)" : "MODE: dry run (no writes)");
  console.log("");

  // Pull every worry along with its parent map (for improvement_goal)
  // and its paired behavior (for behaviorText). Depth-score needs both
  // to score consistently with saveWorry.
  const { data: worries, error: wErr } = await supabase
    .from("itc_worries")
    .select("*")
    .order("created_at");
  if (wErr) throw new Error(`fetch worries: ${wErr.message}`);
  const worriesTyped = (worries ?? []) as ItcWorry[];
  console.log(`Loaded ${worriesTyped.length} worries.`);

  if (worriesTyped.length === 0) {
    console.log("Nothing to rescore.");
    return;
  }

  const mapIds = Array.from(new Set(worriesTyped.map((w) => w.map_id)));
  const behaviorIds = Array.from(new Set(worriesTyped.map((w) => w.behavior_id)));

  const [{ data: maps, error: mErr }, { data: behaviors, error: bErr }] =
    await Promise.all([
      supabase.from("itc_maps").select("id, improvement_goal").in("id", mapIds),
      supabase
        .from("itc_behaviors")
        .select("*")
        .in("id", behaviorIds),
    ]);
  if (mErr) throw new Error(`fetch maps: ${mErr.message}`);
  if (bErr) throw new Error(`fetch behaviors: ${bErr.message}`);
  const mapById = new Map(
    ((maps ?? []) as Pick<ItcMap, "id" | "improvement_goal">[]).map((m) => [
      m.id,
      m,
    ]),
  );
  const behaviorById = new Map(
    ((behaviors ?? []) as ItcBehavior[]).map((b) => [b.id, b]),
  );

  const deltas: ScoreDelta[] = [];
  let processed = 0;

  for (const worry of worriesTyped) {
    processed++;
    const map = mapById.get(worry.map_id);
    const behavior = behaviorById.get(worry.behavior_id);
    if (!map || !behavior) {
      console.warn(
        `skip worry=${worry.id}: missing map or behavior context`,
      );
      continue;
    }

    let scored;
    try {
      scored = await scoreWorryDepth({
        goalText: map.improvement_goal ?? "",
        behaviorText: behavior.text,
        worryText: worry.text,
      });
    } catch (err) {
      console.warn(
        `skip worry=${worry.id}: score failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const sharpen = await composeWorrySharpen({
      worry: { ...worry, depth_score: scored.score },
      behaviors: [behavior],
      depthReason: scored.reason,
    });

    const before = {
      depth_score: worry.depth_score,
      rubric_reason: worry.rubric_reason,
    };
    const after = {
      depth_score: scored.score,
      rubric_reason: sharpen,
    };
    const changed =
      before.depth_score !== after.depth_score ||
      (before.rubric_reason ?? null) !== (after.rubric_reason ?? null);

    deltas.push({
      worryId: worry.id,
      mapId: worry.map_id,
      worryText: worry.text,
      before,
      after,
      changed,
    });

    if (processed % 10 === 0) {
      console.log(`  scored ${processed}/${worriesTyped.length}...`);
    }
  }

  console.log("");
  console.log(`Total scored: ${deltas.length}`);
  const changedDeltas = deltas.filter((d) => d.changed);
  const flippedToFail = changedDeltas.filter(
    (d) => (d.before.depth_score ?? 0) >= 3 && d.after.depth_score < 3,
  );
  const flippedToPass = changedDeltas.filter(
    (d) => (d.before.depth_score ?? 0) < 3 && d.after.depth_score >= 3,
  );
  const otherChanges = changedDeltas.filter(
    (d) => !flippedToFail.includes(d) && !flippedToPass.includes(d),
  );
  console.log(`  no change: ${deltas.length - changedDeltas.length}`);
  console.log(`  changed (any field): ${changedDeltas.length}`);
  console.log(`    flipped PASS → FAIL: ${flippedToFail.length}`);
  console.log(`    flipped FAIL → PASS: ${flippedToPass.length}`);
  console.log(`    same-verdict rubric_reason update: ${otherChanges.length}`);
  console.log("");

  if (flippedToFail.length > 0) {
    console.log("── Flipped PASS → FAIL (these will surface in the hone audit) ──");
    for (const d of flippedToFail) {
      console.log(
        `  worry=${d.worryId} depth ${d.before.depth_score ?? "null"}→${d.after.depth_score}`,
      );
      console.log(`    text: "${d.worryText.slice(0, 120)}${d.worryText.length > 120 ? "…" : ""}"`);
      console.log(`    new reason: ${d.after.rubric_reason?.slice(0, 200) ?? "(none)"}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("Dry run — nothing written. Re-run with --apply to persist.");
    return;
  }

  console.log(`Writing ${changedDeltas.length} updates…`);
  let written = 0;
  let failed = 0;
  for (const d of changedDeltas) {
    const patch: {
      depth_score: number;
      rubric_reason: string | null;
    } = {
      depth_score: d.after.depth_score,
      rubric_reason: d.after.rubric_reason?.trim() || null,
    };
    const { error } = await supabase
      .from("itc_worries")
      .update(patch)
      .eq("id", d.worryId);
    if (error) {
      console.error(`  FAIL worry=${d.worryId}: ${error.message}`);
      failed++;
    } else {
      written++;
    }
  }
  console.log(`Done. Written: ${written}, failed: ${failed}.`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
