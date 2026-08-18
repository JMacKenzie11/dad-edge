/**
 * Persona harness — scripted simulated-coachee runs against the real
 * ITC pipeline (real prompts, real tool schemas, real server actions,
 * seeded test database, real LLM in record mode / stored-response LLM
 * in replay mode).
 *
 * A persona is a sequence of "steps," each either:
 *   { kind: "chat", message: string }           — coachee sends a chat turn
 *   { kind: "accept", proposalIndex: number }   — coachee taps Accept on the
 *                                                  Nth pending proposal card
 *   { kind: "edit", proposalIndex: number, patch: (payload) => payload }
 *                                                — coachee edits then accepts
 *   { kind: "reject", proposalIndex: number }   — coachee taps Pass
 *   { kind: "panel", op: PanelOp }              — coachee interacts via map panel
 *                                                  (add behavior, save goal, etc.)
 *   { kind: "advance", to: ItcStage }           — click Next column
 *
 * After the sequence, the persona's assertions run against the final
 * database state (row counts, pairings, stage, exact accepted texts,
 * turn events).
 */

import { randomUUID } from "node:crypto";
import { anthropic } from "@ai-sdk/anthropic";
import { afterAll, beforeAll } from "vitest";
import { createMap, saveImprovementGoal } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import {
  setMainModelOverride,
  setUtilityModelOverride,
} from "@/lib/model-config";
import type { PillarCode } from "@/lib/pillars";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runCoachTurnForMap } from "@/app/itc/actions";
import { wrapForRecordReplay } from "./recorder";
import path from "node:path";

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/itc-sessions/fixtures");

export type PersonaContext = {
  participantId: string;
  mapId: string;
  pillar: PillarCode;
};

/**
 * Set up record/replay wrappers for main + utility models scoped to
 * this persona. Call inside a describe block via beforeAll/afterAll.
 * fixtureFile is relative to tests/itc-sessions/fixtures/.
 */
export function installPersonaLLM(fixtureFile: string): void {
  beforeAll(() => {
    const modelId =
      process.env.ANTHROPIC_MODEL?.trim() ?? "claude-sonnet-4-5";
    const utilityId =
      process.env.ANTHROPIC_UTILITY_MODEL?.trim() ?? modelId;
    const mainBase = anthropic(modelId);
    const utilityBase = anthropic(utilityId);
    const fixturePath = path.join(FIXTURES_DIR, fixtureFile);
    setMainModelOverride(wrapForRecordReplay(mainBase, fixturePath));
    setUtilityModelOverride(wrapForRecordReplay(utilityBase, fixturePath));
  });
  afterAll(() => {
    setMainModelOverride(null);
    setUtilityModelOverride(null);
  });
}

/**
 * Seed a fresh map for the persona. Optionally jump the map to a
 * specific stage with pre-populated content (goal text, selected
 * behaviors, locked worries, etc.) to focus the persona on a specific
 * flow. Returns the persona context that assertions can use later.
 */
export async function seedPersonaMap(input: {
  pillar?: PillarCode;
  goalText?: string;
  behaviors?: string[];
  jumpToStage?:
    | "goal"
    | "behaviors"
    | "worries"
    | "commitments"
    | "assumptions"
    | "review"
    | "immune_system"
    | "prioritize"
    | "test_design"
    | "test_running"
    | "results";
}): Promise<PersonaContext> {
  const supabase = createSupabaseServiceClient();
  const email = `persona-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const pillar: PillarCode = input.pillar ?? "B";
  const map = await createMap(participant.id, pillar);

  if (input.goalText) {
    await saveImprovementGoal(map.id, input.goalText);
  }

  if (input.behaviors && input.behaviors.length > 0) {
    for (let i = 0; i < input.behaviors.length; i++) {
      await supabase.from("itc_behaviors").insert({
        map_id: map.id,
        text: input.behaviors[i],
        source: "user",
        sort_order: i,
        selected: true,
      });
    }
  }

  if (input.jumpToStage) {
    await supabase
      .from("itc_maps")
      .update({ current_stage: input.jumpToStage })
      .eq("id", map.id);
  }

  return {
    participantId: participant.id,
    mapId: map.id,
    pillar,
  };
}

export async function cleanupPersonaMap(ctx: PersonaContext): Promise<void> {
  const supabase = createSupabaseServiceClient();
  await supabase.from("itc_participants").delete().eq("id", ctx.participantId);
}

/**
 * Send a chat turn from the coachee. Returns the coach's reply text
 * plus any proposal cards attached to the just-created assistant
 * message.
 */
export async function coacheeSendsChat(
  ctx: PersonaContext,
  message: string,
): Promise<{
  reply: string | null;
  proposalCards: Array<{ id: string; action_type: string; payload: unknown }>;
}> {
  const res = await runCoachTurnForMap(ctx.mapId, message);
  if (!res.ok) throw new Error(`coach turn failed: ${res.reason}`);

  const supabase = createSupabaseServiceClient();
  const { data: messages } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", ctx.mapId)
    .order("created_at", { ascending: true });
  const lastAssistant = (messages ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0];
  const reply = lastAssistant?.content ?? null;

  const { data: proposals } = await supabase
    .from("itc_action_proposals")
    .select("*")
    .eq("assistant_message_id", lastAssistant?.id ?? "")
    .order("created_at", { ascending: true });
  return {
    reply,
    proposalCards: (proposals ?? []).map((p) => ({
      id: p.id,
      action_type: p.action_type,
      payload: p.payload,
    })),
  };
}

/**
 * Accept a proposal by id. Same path as the acceptProposal server
 * action; runs through applyCoachAction with all its guards.
 */
export async function coacheeAcceptsProposal(
  ctx: PersonaContext,
  proposalId: string,
): Promise<void> {
  const { acceptProposal } = await import("@/app/itc/actions");
  const fd = new FormData();
  fd.set("proposal_id", proposalId);
  const res = await withStubbedAuth(ctx, () => acceptProposal(fd));
  if (!res.ok) throw new Error(`acceptProposal failed: ${res.reason}`);
}

export async function coacheeEditsAndAccepts(
  ctx: PersonaContext,
  proposalId: string,
  editedPayload: unknown,
): Promise<void> {
  const { editAndAcceptProposal } = await import("@/app/itc/actions");
  const fd = new FormData();
  fd.set("proposal_id", proposalId);
  fd.set("edited_payload", JSON.stringify(editedPayload));
  const res = await withStubbedAuth(ctx, () => editAndAcceptProposal(fd));
  if (!res.ok) throw new Error(`editAndAcceptProposal failed: ${res.reason}`);
}

export async function coacheeRejectsProposal(
  ctx: PersonaContext,
  proposalId: string,
  reason?: string,
): Promise<void> {
  const { rejectProposal } = await import("@/app/itc/actions");
  const fd = new FormData();
  fd.set("proposal_id", proposalId);
  if (reason) fd.set("reason", reason);
  const res = await withStubbedAuth(ctx, () => rejectProposal(fd));
  if (!res.ok) throw new Error(`rejectProposal failed: ${res.reason}`);
}

/**
 * Simulate a coachee adding a behavior directly via the map panel.
 * Mirrors what the `addBehavior` server action does but bypasses the
 * cookie-based auth check (which won't work in a vitest process).
 */
export async function coacheeAddsBehaviorViaPanel(
  ctx: PersonaContext,
  text: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { data: existing } = await supabase
    .from("itc_behaviors")
    .select("*")
    .eq("map_id", ctx.mapId)
    .order("sort_order", { ascending: true });
  const sortOrder = (existing ?? []).length;
  await supabase.from("itc_behaviors").insert({
    map_id: ctx.mapId,
    text: text.trim(),
    source: "user",
    sort_order: sortOrder,
    selected: true,
  });
  const { data: map } = await supabase
    .from("itc_maps")
    .select("current_stage")
    .eq("id", ctx.mapId)
    .single();
  await supabase.from("itc_messages").insert({
    map_id: ctx.mapId,
    role: "system",
    content: `[coachee added behavior via map: "${text.trim()}"]`,
    stage_at_creation: map?.current_stage ?? "behaviors",
  });
}

export async function coacheeAdvancesStageViaPanel(
  ctx: PersonaContext,
  to: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { data: map } = await supabase
    .from("itc_maps")
    .select("current_stage, improvement_goal")
    .eq("id", ctx.mapId)
    .single();
  if (!map) throw new Error("map missing");
  const from = map.current_stage;
  const { advanceStage } = await import("@/lib/itc/maps");
  await advanceStage(ctx.mapId, from, to as never);
  await supabase.from("itc_messages").insert({
    map_id: ctx.mapId,
    role: "system",
    content: `[coachee advanced map via button: ${from} → ${to}]`,
    stage_at_creation: to as never,
  });
}

/**
 * requireItcParticipant() reads cookies which don't exist in a vitest
 * process. Set ITC_TEST_PARTICIPANT_ID for the duration of the call —
 * the test seam in session-guards.ts skips the cookie read and looks
 * up the participant directly.
 */
async function withStubbedAuth<T>(
  ctx: PersonaContext,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = process.env.ITC_TEST_PARTICIPANT_ID;
  process.env.ITC_TEST_PARTICIPANT_ID = ctx.participantId;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ITC_TEST_PARTICIPANT_ID;
    else process.env.ITC_TEST_PARTICIPANT_ID = prev;
  }
}

/**
 * Read the final map state for assertions.
 */
export async function readFinalMapState(ctx: PersonaContext) {
  const supabase = createSupabaseServiceClient();
  const [
    { data: map },
    { data: behaviors },
    { data: worries },
    { data: commitments },
    { data: assumptions },
    { data: tests },
    { data: testResults },
    { data: proposals },
    { data: messages },
    { data: events },
  ] = await Promise.all([
    supabase.from("itc_maps").select("*").eq("id", ctx.mapId).single(),
    supabase.from("itc_behaviors").select("*").eq("map_id", ctx.mapId).order("sort_order", { ascending: true }),
    supabase.from("itc_worries").select("*").eq("map_id", ctx.mapId).order("created_at", { ascending: true }),
    supabase.from("itc_commitments").select("*").eq("map_id", ctx.mapId).order("created_at", { ascending: true }),
    supabase.from("itc_assumptions").select("*").eq("map_id", ctx.mapId).order("sort_order", { ascending: true }),
    supabase.from("itc_tests").select("*").eq("map_id", ctx.mapId).order("created_at", { ascending: true }),
    supabase.from("itc_test_results").select("*").in("test_id", []).order("created_at", { ascending: true }),
    supabase.from("itc_action_proposals").select("*").eq("map_id", ctx.mapId).order("created_at", { ascending: true }),
    supabase.from("itc_messages").select("*").eq("map_id", ctx.mapId).order("created_at", { ascending: true }),
    supabase.from("itc_turn_events").select("*").eq("map_id", ctx.mapId).order("created_at", { ascending: true }),
  ]);
  return {
    map,
    behaviors: behaviors ?? [],
    worries: worries ?? [],
    commitments: commitments ?? [],
    assumptions: assumptions ?? [],
    tests: tests ?? [],
    testResults: testResults ?? [],
    proposals: proposals ?? [],
    messages: messages ?? [],
    events: events ?? [],
  };
}
