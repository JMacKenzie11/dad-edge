/**
 * Checkpoint A demo — worry-box shallow → rubric rejection → same-turn
 * recovery, running against the real coach LLM pipeline.
 *
 * Seeds: fresh participant + map at worries stage, one saved goal, one
 * selected behavior. Runs one coach turn with a coachee message that
 * should elicit a shallow worry proposal. Prints the coach's visible
 * reply, the pending proposals, and the two new turn_events
 * (rubric_rejected_proposal + same_turn_recovery).
 *
 * Cleans up after itself.
 *
 * Usage:
 *   ITC_PIPELINE=tools npx tsx scripts/demo-tools-worry.ts
 */

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createMap, saveImprovementGoal } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runCoachTurnForMap } from "@/app/itc/actions";

async function main() {
  const email = `demo-tools-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, "B");
  const supabase = createSupabaseServiceClient();

  console.log("=".repeat(72));
  console.log("CHECKPOINT A DEMO — worry-box rubric rejection + recovery");
  console.log("=".repeat(72));
  console.log("map_id:", map.id);
  console.log("pillar:", map.pillar_code);
  console.log("stage:", map.current_stage);

  // Seed goal
  const goal =
    "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
  await saveImprovementGoal(map.id, goal);
  console.log("\nSeeded goal:", goal);

  // Seed one selected behavior
  await supabase.from("itc_behaviors").insert({
    map_id: map.id,
    text: "I bring up things she did in the past instead of listening",
    source: "user",
    sort_order: 0,
    selected: true,
  });
  console.log(
    "Seeded behavior #1: 'I bring up things she did in the past instead of listening'",
  );

  // Advance stage worries via direct DB flip (skip UI gates).
  await supabase
    .from("itc_maps")
    .update({ current_stage: "worries" })
    .eq("id", map.id);
  console.log("Advanced stage: worries");

  // Seed the coach's stage-intro so the model has context for turn 1.
  await supabase.from("itc_messages").insert({
    map_id: map.id,
    role: "assistant",
    content:
      "Now the worry box. For behavior #1 — 'I bring up things she did in the past instead of listening' — if you stopped doing that, what part of you is afraid of what would happen next? Tell me here.",
    stage_at_creation: "worries",
  });

  console.log("\n" + "-".repeat(72));
  console.log("COACHEE MESSAGE (deliberately shallow):");
  console.log("-".repeat(72));
  const coacheeMsg =
    "I worry she'd feel like she was right and I'd have nothing to say back. That's the worry. Lock it in.";
  console.log(coacheeMsg);

  console.log("\n" + "-".repeat(72));
  console.log("RUNNING runCoachTurnForMap (pipeline=tools) ...");
  console.log("-".repeat(72));

  const t0 = Date.now();
  const res = await runCoachTurnForMap(map.id, coacheeMsg);
  const totalMs = Date.now() - t0;
  console.log("result:", res, `(${totalMs}ms)`);

  // Print full transcript
  const { data: messages } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", map.id)
    .order("created_at", { ascending: true });

  console.log("\n" + "=".repeat(72));
  console.log("TRANSCRIPT");
  console.log("=".repeat(72));
  for (const m of messages ?? []) {
    console.log(`\n[${m.role}${m.role === "system" ? "" : ""}]`);
    console.log(m.content);
  }

  // Pending proposals for the last assistant message
  const lastAssistant = (messages ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0];
  if (lastAssistant) {
    const { data: proposals } = await supabase
      .from("itc_action_proposals")
      .select("*")
      .eq("assistant_message_id", lastAssistant.id)
      .order("created_at", { ascending: true });
    console.log("\n" + "-".repeat(72));
    console.log(`PROPOSAL CARDS attached to last assistant message (${proposals?.length ?? 0}):`);
    console.log("-".repeat(72));
    for (const p of proposals ?? []) {
      console.log(
        `- action_type=${p.action_type} status=${p.status} source=${p.source}`,
      );
      console.log("  payload:", JSON.stringify(p.payload, null, 2));
    }
  }

  // rubric_rejected_proposal + same_turn_recovery events
  const { data: events } = await supabase
    .from("itc_turn_events")
    .select("*")
    .eq("map_id", map.id)
    .in("event_type", [
      "rubric_rejected_proposal",
      "same_turn_recovery",
      "action_apply",
      "rubric",
      "llm_attempt",
      "turn_summary",
    ])
    .order("created_at", { ascending: true });

  console.log("\n" + "-".repeat(72));
  console.log(`TURN EVENTS (${events?.length ?? 0}):`);
  console.log("-".repeat(72));
  for (const e of events ?? []) {
    console.log(
      `- ${e.event_type} stage=${e.stage ?? "-"} duration=${e.duration_ms ?? "-"}ms`,
    );
    console.log("  payload:", JSON.stringify(e.payload, null, 2));
  }

  // Cleanup
  console.log("\n" + "-".repeat(72));
  console.log("cleaning up...");
  await supabase.from("itc_participants").delete().eq("id", participant.id);
  console.log("done.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
