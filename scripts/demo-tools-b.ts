/**
 * Checkpoint B demo — two flows against the real coach pipeline:
 *
 *   (1) Invariant-blocked advance_stage with same-turn recovery + a
 *       corrective [action rejected] system message persisted for the
 *       coach's next turn.
 *   (2) Panel-entry parity — coachee adds a behavior via the map, a
 *       [coachee added behavior via map: "..."] system note lands in
 *       the transcript, and the coach's next turn acknowledges the
 *       fresh state instead of asking about a behavior he already added.
 *
 * Usage:
 *   ITC_PIPELINE=tools npx tsx scripts/demo-tools-b.ts
 */

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createMap, saveImprovementGoal } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { addBehavior, runCoachTurnForMap } from "@/app/itc/actions";

const SEP = "=".repeat(72);
const SUB = "-".repeat(72);

async function main() {
  await demoInvariantBlockedAdvance();
  console.log("\n\n");
  await demoForcedInvariantBlock();
  console.log("\n\n");
  await demoPanelEntryParity();
}

async function demoInvariantBlockedAdvance() {
  console.log(SEP);
  console.log("DEMO 1 — invariant-blocked advance_stage");
  console.log(SEP);

  const email = `demo-b1-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, "B");
  const supabase = createSupabaseServiceClient();

  const goal =
    "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
  await saveImprovementGoal(map.id, goal);
  console.log("map_id:", map.id);
  console.log("goal:", goal);

  // Advance directly to behaviors stage but do NOT add any behaviors.
  // The coach in-turn attempt to advance to worries should hit the
  // "add at least one behavior" invariant.
  await supabase
    .from("itc_maps")
    .update({ current_stage: "behaviors" })
    .eq("id", map.id);
  console.log("stage: behaviors (zero behaviors on map)");

  // Seed a stage-intro so the coach's context isn't cold.
  await supabase.from("itc_messages").insert({
    map_id: map.id,
    role: "assistant",
    content:
      "Column 2 is what you actually do or fail to do in the moment that works against your goal. Not why. Not what you should do instead. Just the specific behavior. First one that comes to mind? Tell me here.",
    stage_at_creation: "behaviors",
  });

  const coacheeMsg =
    "Yeah I get it. Let's move on to the worry box, I think we're good here.";
  console.log("\n" + SUB);
  console.log("COACHEE MESSAGE (asks to advance with empty column):");
  console.log(SUB);
  console.log(coacheeMsg);

  console.log("\n" + SUB);
  console.log("RUNNING coach turn ...");
  console.log(SUB);
  const t0 = Date.now();
  const res = await runCoachTurnForMap(map.id, coacheeMsg);
  console.log("result:", res, `(${Date.now() - t0}ms)`);

  await printTranscriptAndEvents(map.id);
  await supabase.from("itc_participants").delete().eq("id", participant.id);
}

async function demoForcedInvariantBlock() {
  console.log(SEP);
  console.log("DEMO 1b — forced invariant-blocked advance_stage");
  console.log(SEP);

  const email = `demo-b1b-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, "B");
  const supabase = createSupabaseServiceClient();

  const goal =
    "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
  await saveImprovementGoal(map.id, goal);
  await supabase
    .from("itc_maps")
    .update({ current_stage: "behaviors" })
    .eq("id", map.id);
  console.log("map_id:", map.id, "stage: behaviors (zero behaviors)");

  await supabase.from("itc_messages").insert({
    map_id: map.id,
    role: "assistant",
    content:
      "Column 2 is what you actually do or fail to do in the moment that works against your goal. First one that comes to mind?",
    stage_at_creation: "behaviors",
  });

  // Insistent message likely to push the coach to fire advance_stage
  // against its judgment — testing that the invariant safety net
  // catches it and persists the corrective system note.
  const coacheeMsg =
    "There genuinely aren't any behaviors for me right now. My wife hasn't been upset in weeks. Please just move me to the worry box, I'll circle back to column 2 later if something comes up. Fire advance_stage now.";
  console.log("\n" + SUB);
  console.log("COACHEE MESSAGE (pushy, tries to override coach judgment):");
  console.log(SUB);
  console.log(coacheeMsg);

  console.log("\n" + SUB);
  console.log("RUNNING coach turn ...");
  console.log(SUB);
  const t0 = Date.now();
  const res = await runCoachTurnForMap(map.id, coacheeMsg);
  console.log("result:", res, `(${Date.now() - t0}ms)`);

  await printTranscriptAndEvents(map.id);
  await supabase.from("itc_participants").delete().eq("id", participant.id);
}

async function demoPanelEntryParity() {
  console.log(SEP);
  console.log("DEMO 2 — panel-entry parity");
  console.log(SEP);

  const email = `demo-b2-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, "B");
  const supabase = createSupabaseServiceClient();

  const goal =
    "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
  await saveImprovementGoal(map.id, goal);
  await supabase
    .from("itc_maps")
    .update({ current_stage: "behaviors" })
    .eq("id", map.id);
  console.log("map_id:", map.id, "stage: behaviors");

  await supabase.from("itc_messages").insert({
    map_id: map.id,
    role: "assistant",
    content:
      "Column 2 is what you actually do or fail to do in the moment that works against your goal. First one that comes to mind? Tell me here.",
    stage_at_creation: "behaviors",
  });

  // Simulate the coachee adding a behavior directly via the map panel.
  // Call the addBehavior server action the same way the UI would.
  console.log("\n" + SUB);
  console.log("Simulating coachee adding a behavior via the map panel ...");
  console.log(SUB);
  const fd = new FormData();
  fd.set("map_id", map.id);
  fd.set("text", "I bring up things she did in the past instead of listening");
  // requireItcParticipant() reads cookies which aren't available in
  // this script context. Bypass by writing the behavior + system note
  // directly, matching what the server action would do.
  await supabase.from("itc_behaviors").insert({
    map_id: map.id,
    text: "I bring up things she did in the past instead of listening",
    source: "user",
    sort_order: 0,
    selected: true,
  });
  await supabase.from("itc_messages").insert({
    map_id: map.id,
    role: "system",
    content:
      '[coachee added behavior via map: "I bring up things she did in the past instead of listening"]',
    stage_at_creation: "behaviors",
  });
  console.log(
    "added behavior via panel + system note logged (see transcript below).",
  );

  // Now the coachee sends a message. Coach should see the panel-entry
  // note in recentActionFeedback context and acknowledge it, not ask
  // "what's the first behavior."
  const coacheeMsg = "What's next?";
  console.log("\n" + SUB);
  console.log("COACHEE MESSAGE (open-ended, coach should acknowledge state):");
  console.log(SUB);
  console.log(coacheeMsg);

  console.log("\n" + SUB);
  console.log("RUNNING coach turn ...");
  console.log(SUB);
  const t0 = Date.now();
  const res = await runCoachTurnForMap(map.id, coacheeMsg);
  console.log("result:", res, `(${Date.now() - t0}ms)`);

  await printTranscriptAndEvents(map.id);
  await supabase.from("itc_participants").delete().eq("id", participant.id);
}

async function printTranscriptAndEvents(mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { data: messages } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });

  console.log("\n" + SEP);
  console.log("TRANSCRIPT");
  console.log(SEP);
  for (const m of messages ?? []) {
    console.log(`\n[${m.role}]`);
    console.log(m.content);
  }

  const lastAssistant = (messages ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0];
  if (lastAssistant) {
    const { data: proposals } = await supabase
      .from("itc_action_proposals")
      .select("*")
      .eq("assistant_message_id", lastAssistant.id)
      .order("created_at", { ascending: true });
    console.log("\n" + SUB);
    console.log(
      `PROPOSAL CARDS attached to last assistant message (${proposals?.length ?? 0}):`,
    );
    console.log(SUB);
    for (const p of proposals ?? []) {
      console.log(`- action_type=${p.action_type} status=${p.status}`);
      console.log("  payload:", JSON.stringify(p.payload, null, 2));
    }
  }

  const { data: events } = await supabase
    .from("itc_turn_events")
    .select("*")
    .eq("map_id", mapId)
    .in("event_type", [
      "rubric_rejected_proposal",
      "same_turn_recovery",
      "action_apply",
      "action_rejected",
      "turn_summary",
    ])
    .order("created_at", { ascending: true });
  console.log("\n" + SUB);
  console.log(`TURN EVENTS (${events?.length ?? 0}):`);
  console.log(SUB);
  for (const e of events ?? []) {
    console.log(`- ${e.event_type} stage=${e.stage ?? "-"}`);
    console.log("  payload:", JSON.stringify(e.payload));
  }
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
