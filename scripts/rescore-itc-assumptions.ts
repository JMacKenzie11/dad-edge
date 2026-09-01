/**
 * One-shot backfill: re-score every itc_assumptions row against the
 * current scoreAssumptionDepth rubric and rewrite the row's coach
 * text where the verdict changed.
 *
 * Why: the assumption rubric's identity criterion was brought in line
 * with the worry rubric (2026-09-01). Assumptions whose "then" is a
 * bare failure event or a comparative hedge ("I may not be as capable
 * as they think") used to score 3/3 and now score lower. The audit
 * reads the STORED score, so without a re-score those rows stay
 * silently passed.
 *
 * Runs the SAME coachTextForAssumption path saveAssumption uses, so
 * the persisted rubric_reason / sharpen_text / suggested_fix triple
 * is exactly what a fresh save would write.
 *
 * Only writes when (depth_score, sharpen_text) actually change, so
 * no-op re-scores don't bump anything. (Coach-text columns don't
 * trip the staleness triggers anyway; depth_score does not either.)
 *
 * Usage:
 *
 *   npm run itc:rescore-assumptions               (dry run)
 *   npm run itc:rescore-assumptions -- --apply    (writes to DB)
 *
 * Idempotent: re-runs with no rubric change produce zero updates.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { coachTextForAssumption } from "@/lib/itc/fixes";
import { scoreAssumptionDepth } from "@/lib/itc/rubric";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
  ItcMap,
  ItcWorry,
} from "@/lib/itc/maps";

const APPLY = process.argv.includes("--apply");

type ScoreDelta = {
  assumptionId: string;
  mapId: string;
  text: string;
  before: { depth_score: number | null; sharpen_text: string | null };
  after: {
    depth_score: number;
    rubric_reason: string | null;
    sharpen_text: string | null;
    suggested_fix: string | null;
  };
  changed: boolean;
};

async function main() {
  const supabase = createSupabaseServiceClient();
  console.log(APPLY ? "MODE: apply (writes)" : "MODE: dry run (no writes)");
  console.log("");

  const { data: assumptions, error: aErr } = await supabase
    .from("itc_assumptions")
    .select("*")
    .order("created_at");
  if (aErr) throw new Error(`fetch assumptions: ${aErr.message}`);
  const rows = (assumptions ?? []) as ItcAssumption[];
  console.log(`Loaded ${rows.length} assumptions.`);
  if (rows.length === 0) {
    console.log("Nothing to rescore.");
    return;
  }

  const mapIds = Array.from(new Set(rows.map((a) => a.map_id)));
  const [maps, links, commitments, worries, behaviors] = await Promise.all([
    supabase.from("itc_maps").select("id, improvement_goal").in("id", mapIds),
    supabase
      .from("itc_assumption_commitments")
      .select("assumption_id, commitment_id")
      .in("assumption_id", rows.map((a) => a.id)),
    supabase.from("itc_commitments").select("*").in("map_id", mapIds),
    supabase.from("itc_worries").select("*").in("map_id", mapIds),
    supabase.from("itc_behaviors").select("*").in("map_id", mapIds),
  ]);
  for (const [name, r] of Object.entries({ maps, links, commitments, worries, behaviors })) {
    if (r.error) throw new Error(`fetch ${name}: ${r.error.message}`);
  }
  const mapById = new Map(
    ((maps.data ?? []) as Pick<ItcMap, "id" | "improvement_goal">[]).map((m) => [m.id, m]),
  );
  const linksTyped = (links.data ?? []) as ItcAssumptionCommitment[];
  const commitmentById = new Map(
    ((commitments.data ?? []) as ItcCommitment[]).map((c) => [c.id, c]),
  );
  const worryById = new Map(((worries.data ?? []) as ItcWorry[]).map((w) => [w.id, w]));
  const behaviorsByMap = new Map<string, ItcBehavior[]>();
  for (const b of (behaviors.data ?? []) as ItcBehavior[]) {
    const arr = behaviorsByMap.get(b.map_id) ?? [];
    arr.push(b);
    behaviorsByMap.set(b.map_id, arr);
  }

  const deltas: ScoreDelta[] = [];
  let processed = 0;
  for (const assumption of rows) {
    processed++;
    const map = mapById.get(assumption.map_id);
    if (!map) {
      console.warn(`skip assumption=${assumption.id}: missing map`);
      continue;
    }
    let scored;
    try {
      scored = await scoreAssumptionDepth({
        goalText: map.improvement_goal ?? "",
        assumptionText: assumption.text,
      });
    } catch (err) {
      console.warn(
        `skip assumption=${assumption.id}: score failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const linkedCommitments = linksTyped
      .filter((l) => l.assumption_id === assumption.id)
      .map((l) => commitmentById.get(l.commitment_id))
      .filter((c): c is ItcCommitment => Boolean(c))
      .map((c) => ({
        text: c.text,
        worry_text: worryById.get(c.worry_id)?.text ?? "",
      }));
    const coach = await coachTextForAssumption({
      goalText: map.improvement_goal ?? "",
      assumption,
      linkedCommitments,
      behaviors: (behaviorsByMap.get(assumption.map_id) ?? []).filter((b) => b.selected),
      score: scored.score,
      depthReason: scored.reason,
    });
    const before = {
      depth_score: assumption.depth_score,
      sharpen_text: assumption.sharpen_text,
    };
    const after = {
      depth_score: scored.score,
      rubric_reason: coach.rubricReason ?? null,
      sharpen_text: coach.sharpenText ?? null,
      suggested_fix: coach.suggestedFix ?? null,
    };
    const changed =
      before.depth_score !== after.depth_score ||
      (before.sharpen_text ?? null) !== (after.sharpen_text ?? null);
    deltas.push({
      assumptionId: assumption.id,
      mapId: assumption.map_id,
      text: assumption.text,
      before,
      after,
      changed,
    });
    if (processed % 10 === 0) {
      console.log(`  scored ${processed}/${rows.length}...`);
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
  console.log(`  no change: ${deltas.length - changedDeltas.length}`);
  console.log(`  changed (any field): ${changedDeltas.length}`);
  console.log(`    flipped PASS → FAIL: ${flippedToFail.length}`);
  console.log(`    flipped FAIL → PASS: ${flippedToPass.length}`);
  console.log(
    `    same-verdict coach-text update: ${changedDeltas.length - flippedToFail.length - flippedToPass.length}`,
  );
  console.log("");

  if (flippedToFail.length > 0) {
    console.log("── Flipped PASS → FAIL (these will surface in the hone audit) ──");
    for (const d of flippedToFail) {
      console.log(
        `  assumption=${d.assumptionId} map=${d.mapId} depth ${d.before.depth_score ?? "null"}→${d.after.depth_score}`,
      );
      console.log(`    text: "${d.text.slice(0, 140)}${d.text.length > 140 ? "…" : ""}"`);
      console.log(`    coach: ${d.after.sharpen_text?.slice(0, 200) ?? "(none)"}`);
      console.log(`    fix: ${d.after.suggested_fix ?? "(none)"}`);
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
    const { error } = await supabase
      .from("itc_assumptions")
      .update({
        depth_score: d.after.depth_score,
        rubric_reason: d.after.rubric_reason?.trim() || null,
        sharpen_text: d.after.sharpen_text?.trim() || null,
        suggested_fix: d.after.suggested_fix?.trim() || null,
      })
      .eq("id", d.assumptionId);
    if (error) {
      console.error(`  FAIL assumption=${d.assumptionId}: ${error.message}`);
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
