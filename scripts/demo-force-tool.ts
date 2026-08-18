/**
 * Verifies the toolChoice='propose_behavior' force works when the
 * coachee sends a plain behavior candidate on the behaviors stage.
 */

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createMap, saveImprovementGoal } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runCoachTurnForMap } from "@/app/itc/actions";

async function main() {
  const supabase = createSupabaseServiceClient();
  const email = `demo-force-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, "B");

  await saveImprovementGoal(
    map.id,
    "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.",
  );
  await supabase
    .from("itc_maps")
    .update({ current_stage: "behaviors" })
    .eq("id", map.id);
  await supabase.from("itc_messages").insert({
    map_id: map.id,
    role: "assistant",
    content:
      "Column 2 is what you actually do, or fail to do, in the moment that works against your goal. What's the first one that comes to mind?",
    stage_at_creation: "behaviors",
  });

  const coacheeMsg = "I bring up things she did in the past instead of listening to her";
  console.log("[coachee]", coacheeMsg);
  console.log("");
  const t0 = Date.now();
  const res = await runCoachTurnForMap(map.id, coacheeMsg);
  console.log("[result]", res, `(${Date.now() - t0}ms)`);
  console.log("");

  const { data: messages } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", map.id)
    .order("created_at", { ascending: true });
  const lastAssistant = (messages ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0];
  console.log("[coach reply]");
  console.log(lastAssistant?.content ?? "(no reply)");
  console.log("");

  const { data: proposals } = await supabase
    .from("itc_action_proposals")
    .select("*")
    .eq("assistant_message_id", lastAssistant?.id ?? "")
    .order("created_at", { ascending: true });
  console.log(`[proposals: ${proposals?.length ?? 0}]`);
  for (const p of proposals ?? []) {
    console.log(`  - ${p.action_type} status=${p.status}`);
    console.log(`    payload:`, JSON.stringify(p.payload));
  }

  await supabase.from("itc_participants").delete().eq("id", participant.id);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
