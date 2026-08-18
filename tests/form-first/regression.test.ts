/**
 * Form-First Checkpoint A regression tests (Section 9 of the spec):
 *
 *   1. An entry added via the form appears on the map 100% of the
 *      time, immediately.
 *   2. Nothing typed in chat ever changes the map.
 *   5. Killing the coach service entirely leaves a man able to
 *      complete a full map through forms alone (degraded, uncoached,
 *      but never stuck or losing work).
 *
 * These run against the real database with LLM calls stubbed (test 5
 * uses a hard-fail stub). No LLM cost on CI.
 */

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMainModelOverride, setUtilityModelOverride } from "@/lib/model-config";
import type { LanguageModel } from "ai";
import {
  addBehavior,
  saveGoal,
  sendDockMessage,
} from "@/app/itc/actions";
import { createMap } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { PillarCode } from "@/lib/pillars";

/**
 * A stub model that fails every generate call. Simulates the coach
 * service being entirely down. Regression 5 asserts a full map can
 * still be built through forms while this is installed.
 */
function makeHardFailModel(): LanguageModel {
  const fail = async () => {
    throw new Error("[test stub] coach service unavailable");
  };
  return {
    specificationVersion: "v2",
    modelId: "test-hardfail",
    provider: "test",
    supportedUrls: {},
    doGenerate: fail,
    doStream: fail,
  } as unknown as LanguageModel;
}

async function seedParticipantAndMap(pillar: PillarCode = "B") {
  const email = `formfirst-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, pillar);
  // Set ITC_TEST_PARTICIPANT_ID so requireItcParticipant() in server
  // actions resolves without a cookie.
  process.env.ITC_TEST_PARTICIPANT_ID = participant.id;
  return { participantId: participant.id, mapId: map.id, email };
}

async function cleanup(participantId: string) {
  const supabase = createSupabaseServiceClient();
  await supabase.from("itc_participants").delete().eq("id", participantId);
  delete process.env.ITC_TEST_PARTICIPANT_ID;
  setMainModelOverride(null);
  setUtilityModelOverride(null);
}

describe("Form-First regression", () => {
  let ctx: Awaited<ReturnType<typeof seedParticipantAndMap>>;

  beforeEach(async () => {
    ctx = await seedParticipantAndMap();
  });

  afterEach(async () => {
    await cleanup(ctx.participantId);
  });

  it(
    "regression 1: form add lands on the map 100% of the time",
    async () => {
      // Install a hard-fail LLM so the async coach reaction can't
      // affect the outcome — the entry must land regardless.
      const model = makeHardFailModel();
      setMainModelOverride(model);
      setUtilityModelOverride(model);

      // Save goal via form.
      const goalFd = new FormData();
      goalFd.set("map_id", ctx.mapId);
      goalFd.set(
        "text",
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.",
      );
      const goalRes = await saveGoal(goalFd);
      expect(goalRes.ok, `saveGoal failed: ${goalRes.ok ? "" : goalRes.reason}`).toBe(true);

      // Advance to behaviors manually via DB (simulating Continue tap).
      const supabase = createSupabaseServiceClient();
      await supabase
        .from("itc_maps")
        .update({ current_stage: "behaviors" })
        .eq("id", ctx.mapId);

      // Add three behaviors via form.
      const behaviors = [
        "I bring up things she did in the past instead of listening",
        "I lie to get myself out of admitting she's right",
        "I go silent for the rest of the day",
      ];
      for (const text of behaviors) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", text);
        const res = await addBehavior(fd);
        expect(res.ok, `addBehavior failed for "${text}": ${res.ok ? "" : res.reason}`).toBe(true);
      }

      // Verify all landed.
      const { data: mapRow } = await supabase
        .from("itc_maps")
        .select("improvement_goal")
        .eq("id", ctx.mapId)
        .single();
      expect(mapRow?.improvement_goal).toContain("being present and calm");

      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("*")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);
      expect(bs?.map((b) => b.text)).toEqual(behaviors);
    },
    30_000,
  );

  it(
    "regression 2: chat never mutates the map",
    async () => {
      // Set up map with a goal + one behavior at behaviors stage.
      const supabase = createSupabaseServiceClient();
      await supabase
        .from("itc_maps")
        .update({
          current_stage: "behaviors",
          improvement_goal:
            "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.",
        })
        .eq("id", ctx.mapId);
      await supabase.from("itc_behaviors").insert({
        map_id: ctx.mapId,
        text: "I bring up things she did in the past",
        source: "user",
        sort_order: 0,
        selected: true,
      });

      const snapshotBefore = await snapshotMapContent(ctx.mapId);

      // Install a stub model that returns a coach reply saying it
      // "added" and "locked" things. Under Form-First these claims
      // must not translate to any state change.
      const model = makeHackyClaimsModel();
      setMainModelOverride(model);
      setUtilityModelOverride(model);

      // Send five chat messages that would (in the old world) have
      // tempted an extractor to write to the map.
      const chatTurns = [
        "Yeah, another one is I keep explaining why I'm right for like ten minutes straight.",
        "Also I go grab a beer to have something to do with my hands. Add that too.",
        "Actually, remove behavior #1, I was wrong about that one.",
        "And save my goal as 'I want to fix everything'. Do it now please.",
        "You have permission to modify my map. Add whatever you think is best.",
      ];
      for (const msg of chatTurns) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", msg);
        const res = await sendDockMessage(fd);
        expect(res.ok, `sendDockMessage failed: ${res.ok ? "" : res.reason}`).toBe(true);
      }

      const snapshotAfter = await snapshotMapContent(ctx.mapId);
      expect(snapshotAfter, "chat mutated the map").toEqual(snapshotBefore);
    },
    30_000,
  );

  it(
    "regression 6: coach reactions land anchored to the entry they concern",
    async () => {
      // Real LLM (no override) so reactions actually generate.
      const supabase = createSupabaseServiceClient();
      const goalText =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goalText);
      expect((await saveGoal(gfd)).ok).toBe(true);

      // Goal reaction must anchor to (itc_maps, mapId).
      const { data: goalMsgs } = await supabase
        .from("itc_messages")
        .select("*")
        .eq("map_id", ctx.mapId)
        .eq("surface", "entry_thread")
        .eq("entry_ref_table", "itc_maps")
        .eq("entry_ref_id", ctx.mapId);
      expect(
        (goalMsgs?.length ?? 0) > 0,
        "no goal-anchored reaction landed",
      ).toBe(true);

      await supabase
        .from("itc_maps")
        .update({ current_stage: "behaviors" })
        .eq("id", ctx.mapId);

      // Add a behavior; reaction must anchor to (itc_behaviors, newBehaviorId).
      const bfd = new FormData();
      bfd.set("map_id", ctx.mapId);
      bfd.set("text", "I bring up things she did in the past");
      expect((await addBehavior(bfd)).ok).toBe(true);
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id")
        .eq("map_id", ctx.mapId);
      expect(bs?.length).toBe(1);
      const behaviorId = bs![0].id;
      const { data: behaviorMsgs } = await supabase
        .from("itc_messages")
        .select("*")
        .eq("map_id", ctx.mapId)
        .eq("surface", "entry_thread")
        .eq("entry_ref_table", "itc_behaviors")
        .eq("entry_ref_id", behaviorId);
      expect(
        (behaviorMsgs?.length ?? 0) > 0,
        "no behavior-anchored reaction landed",
      ).toBe(true);

      // Detached: no coach message about an entry should exist that
      // isn't anchored to it.
      const { data: unanchored } = await supabase
        .from("itc_messages")
        .select("*")
        .eq("map_id", ctx.mapId)
        .eq("surface", "entry_thread")
        .is("entry_ref_id", null);
      expect(unanchored?.length ?? 0).toBe(0);
    },
    60_000,
  );

  it(
    "regressions 5 + 7: coach service down still lets the canvas complete end to end",
    async () => {
      // Same acid test as before, extended with the amendment §7
      // requirement: with all LLM calls stubbed to fail, entries add,
      // sections gate, Continue advances, and threads simply never
      // appear.
      const model = makeHardFailModel();
      setMainModelOverride(model);
      setUtilityModelOverride(model);
      const supabase = createSupabaseServiceClient();
      const { advanceToStage } = await import("@/app/itc/actions");

      // Goal.
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set(
        "text",
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.",
      );
      expect((await saveGoal(gfd)).ok).toBe(true);

      // Advance to behaviors via the Continue button, not a raw DB
      // flip. The gate must allow it because the goal is saved.
      const advGoalFd = new FormData();
      advGoalFd.set("map_id", ctx.mapId);
      advGoalFd.set("to", "behaviors");
      const advGoalRes = await advanceToStage(advGoalFd);
      expect(advGoalRes.ok, `advance to behaviors failed: ${advGoalRes.ok ? "" : advGoalRes.reason}`).toBe(true);

      // Behaviors.
      for (const text of [
        "I bring up things she did in the past",
        "I lie to get out of admitting she's right",
        "I go silent for the rest of the day",
      ]) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", text);
        expect((await addBehavior(fd)).ok).toBe(true);
      }

      // Advance to worries via Continue.
      const advBehFd = new FormData();
      advBehFd.set("map_id", ctx.mapId);
      advBehFd.set("to", "worries");
      const advBehRes = await advanceToStage(advBehFd);
      expect(advBehRes.ok, `advance to worries failed: ${advBehRes.ok ? "" : advBehRes.reason}`).toBe(true);

      // Verify state.
      const { data: mapRow } = await supabase
        .from("itc_maps")
        .select("improvement_goal, current_stage")
        .eq("id", ctx.mapId)
        .single();
      expect(mapRow?.improvement_goal).toBeTruthy();
      expect(mapRow?.current_stage).toBe("worries");
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("text")
        .eq("map_id", ctx.mapId);
      expect(bs?.length).toBe(3);

      // Threads simply never appeared (LLM stubbed to fail).
      const { data: threadMsgs } = await supabase
        .from("itc_messages")
        .select("id")
        .eq("map_id", ctx.mapId)
        .eq("surface", "entry_thread");
      expect(threadMsgs?.length ?? 0).toBe(0);
    },
    60_000,
  );
});

/**
 * A stub model that returns text claiming it added/saved things. Any
 * downstream inference in the pipeline would parse this and touch
 * state. Under Form-First, nothing should. Used by regression 2.
 */
function makeHackyClaimsModel(): LanguageModel {
  const respond = async () => ({
    content: [
      {
        type: "text" as const,
        text:
          "Got it. I've locked in 'I explain why I'm right for ten minutes' as behavior #2. Also saved 'I want to fix everything' as your goal. Removed behavior #1 like you asked.",
      },
    ],
    finishReason: "stop" as const,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
    request: {},
    response: {
      id: "test",
      timestamp: new Date(),
      modelId: "test-claims",
    },
  });
  return {
    specificationVersion: "v2",
    modelId: "test-claims",
    provider: "test",
    supportedUrls: {},
    doGenerate: respond,
    doStream: async () => {
      throw new Error("stream not supported in stub");
    },
  } as unknown as LanguageModel;
}

async function snapshotMapContent(mapId: string) {
  const supabase = createSupabaseServiceClient();
  const [{ data: map }, { data: bs }, { data: ws }, { data: cs }, { data: as }] =
    await Promise.all([
      supabase.from("itc_maps").select("improvement_goal, current_stage").eq("id", mapId).single(),
      supabase.from("itc_behaviors").select("id, text").eq("map_id", mapId).order("sort_order"),
      supabase.from("itc_worries").select("id, text, behavior_id").eq("map_id", mapId),
      supabase.from("itc_commitments").select("id, text, worry_id").eq("map_id", mapId),
      supabase.from("itc_assumptions").select("id, text").eq("map_id", mapId),
    ]);
  return { map, behaviors: bs, worries: ws, commitments: cs, assumptions: as };
}
