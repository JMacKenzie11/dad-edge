/**
 * Checkpoint C demo — voice / natural proposal language / natural
 * post-acceptance acknowledgment.
 *
 * Shows:
 *  (1) Coach receives a behavior candidate from the coachee, proposes
 *      a lightly-sharpened version naturally in prose while firing
 *      propose_behavior. No "click the card," no "hit Add," no
 *      "the map on the right", no reference to any UI element.
 *  (2) We simulate the coachee accepting the proposal (matches what
 *      the acceptProposal server action does): write the behavior
 *      row + append [coachee accepted propose_behavior proposal].
 *  (3) Coach's next turn opens by moving the work forward. No "great,
 *      that's been added to your map." No praise words. Just the
 *      next probe grounded in the entry that just landed.
 *
 * Usage:
 *   ITC_PIPELINE=tools npx tsx scripts/demo-tools-c.ts
 */

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createMap, saveImprovementGoal } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runCoachTurnForMap } from "@/app/itc/actions";

const SEP = "=".repeat(72);
const SUB = "-".repeat(72);

// Banned language per docs/coach-voice-and-tone.md. Every coach reply
// in the demo is scanned; hits get flagged with the offending phrase.
const UI_BANS = [
  "paste",
  "click",
  "tap",
  "hit save",
  "hit add",
  "hit the",
  "the add button",
  "the save button",
  "the next column button",
  "the card below",
  "the map on the right",
  "column 2 input",
  "the form",
  "the field",
  "the panel",
];
const VALIDATION_BANS = [
  "rubric",
  "rejected",
  "not deep enough",
  "didn't pass",
  "validation",
  "score",
  "threshold",
];
const PRAISE_BANS = [
  "great",
  "beautifully",
  "perfectly put",
  "amazing",
  "that's been added",
  "added to your map",
];

function scanReply(reply: string, label: string): void {
  const lower = reply.toLowerCase();
  const hits: string[] = [];
  for (const b of [...UI_BANS, ...VALIDATION_BANS, ...PRAISE_BANS]) {
    if (lower.includes(b)) hits.push(b);
  }
  if (hits.length === 0) {
    console.log(`✓ ${label} — clean, no banned phrases.`);
  } else {
    console.log(`✗ ${label} — hit banned phrases: ${hits.join(", ")}`);
  }
}

async function main() {
  const supabase = createSupabaseServiceClient();
  const email = `demo-c-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, "B");

  const goal =
    "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
  await saveImprovementGoal(map.id, goal);
  await supabase
    .from("itc_maps")
    .update({ current_stage: "behaviors" })
    .eq("id", map.id);
  await supabase.from("itc_messages").insert({
    map_id: map.id,
    role: "assistant",
    content:
      "Column 2 is what you actually do or fail to do in the moment that works against your goal. First one that comes to mind?",
    stage_at_creation: "behaviors",
  });

  console.log(SEP);
  console.log("CHECKPOINT C DEMO — natural proposal + natural acknowledgment");
  console.log(SEP);
  console.log("map:", map.id, "stage: behaviors");

  // === Turn 1: coachee describes a moment, coach proposes ===
  const t1Msg =
    "When she gets mad at me, I lie to get myself out of the situation. Like I'll say I have a call or I need to grab something from upstairs.";
  console.log("\n" + SUB);
  console.log("TURN 1 — coachee describes a moment");
  console.log(SUB);
  console.log("[coachee]", t1Msg);

  const t0 = Date.now();
  await runCoachTurnForMap(map.id, t1Msg);
  const t1Elapsed = Date.now() - t0;

  const { data: msgsAfterT1 } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", map.id)
    .order("created_at", { ascending: true });
  const coachT1 = (msgsAfterT1 ?? []).filter((m) => m.role === "assistant").slice(-1)[0];

  console.log(`[coach] (${t1Elapsed}ms)`);
  console.log(coachT1.content);
  scanReply(coachT1.content, "Turn 1 coach reply");

  const { data: proposals } = await supabase
    .from("itc_action_proposals")
    .select("*")
    .eq("assistant_message_id", coachT1.id)
    .order("created_at", { ascending: true });
  console.log(`\nProposal cards queued: ${proposals?.length ?? 0}`);
  for (const p of proposals ?? []) {
    console.log(
      `  - ${p.action_type} status=${p.status} payload:`,
      JSON.stringify(p.payload),
    );
  }

  // === Simulate acceptance of the first propose_behavior proposal ===
  const behaviorProp = (proposals ?? []).find(
    (p) => p.action_type === "propose_behavior",
  );
  if (behaviorProp) {
    const payload = behaviorProp.payload as { text: string };
    console.log("\n" + SUB);
    console.log("Simulating coachee TAP-ACCEPT on the propose_behavior card ...");
    console.log(SUB);
    console.log(`accepting text: "${payload.text}"`);
    // Insert the behavior row (matches applyCoachAction propose_behavior)
    await supabase.from("itc_behaviors").insert({
      map_id: map.id,
      text: payload.text,
      source: "suggested",
      sort_order: 0,
      selected: true,
    });
    // Lock the proposal
    await supabase
      .from("itc_action_proposals")
      .update({ status: "locked", resolved_at: new Date().toISOString() })
      .eq("id", behaviorProp.id);
    // Append the accept system note (matches acceptProposal server action)
    await supabase.from("itc_messages").insert({
      map_id: map.id,
      role: "system",
      content: `[coachee accepted propose_behavior proposal]`,
      stage_at_creation: "behaviors",
    });
  } else {
    console.log(
      "\n(no propose_behavior proposal fired in turn 1 — coach chose to excavate first)",
    );
  }

  // === Turn 2: coachee sends open-ended follow-up ===
  const t2Msg = "Yeah that's the move.";
  console.log("\n" + SUB);
  console.log("TURN 2 — coachee confirms + asks for next");
  console.log(SUB);
  console.log("[coachee]", t2Msg);

  const t2Start = Date.now();
  await runCoachTurnForMap(map.id, t2Msg);
  const t2Elapsed = Date.now() - t2Start;

  const { data: msgsAfterT2 } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", map.id)
    .order("created_at", { ascending: true });
  const coachT2 = (msgsAfterT2 ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0];

  console.log(`[coach] (${t2Elapsed}ms)`);
  console.log(coachT2.content);
  scanReply(coachT2.content, "Turn 2 coach reply");

  // Full transcript for review
  console.log("\n" + SEP);
  console.log("FULL TRANSCRIPT");
  console.log(SEP);
  for (const m of msgsAfterT2 ?? []) {
    console.log(`\n[${m.role}]`);
    console.log(m.content);
  }

  await supabase.from("itc_participants").delete().eq("id", participant.id);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
