/**
 * LIVE tests. Every case in this file seeds a real map and makes real
 * model calls, so the file takes ~5 minutes while the other 444 tests
 * in the repo take ~4 seconds together.
 *
 * `npm run test:itc` EXCLUDES this file, and that is the right default
 * while iterating. Run `npm run test:itc:live` (or `test:itc:all`)
 * when you have touched something these actually exercise:
 *
 *   - src/app/itc/actions.ts       (save / advance / gate paths)
 *   - src/lib/itc/coach.ts         (drafters and revisers)
 *   - src/lib/itc/rubric.ts        (the judges' behaviour, not just
 *                                   their prompt text)
 *   - the advance pipeline, or anything that writes to the database
 *
 * A prompt-only edit, a copy change, or a UI change does not need
 * them: the structural guards in units.test.ts and src/lib/itc/
 * __tests__ read the same source files and run instantly.
 *
 * They are also the only flaky tests here, because a real model
 * sometimes answers a borderline case the other way. A single failure
 * on re-run is usually that, not a regression.
 */
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
  getAdvanceGate,
  updateBehavior,
  saveAssumption,
  saveCommitment,
  saveGoal,
  saveWorry,
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

/**
 * Advance to commitments auto-derives one commitment per worry
 * (2026-08-31). Tests that used to seed commitments directly now
 * bring the derived rows to depth 3 instead, inserting only when the
 * drafter left a worry without one (LLM hiccup), so the column has
 * exactly one deep commitment per worry either way.
 */
async function ensureDeepCommitments(
  mapId: string,
  worryIds: string[],
  text: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  for (const worryId of worryIds) {
    const { data: existing } = await supabase
      .from("itc_commitments")
      .select("id")
      .eq("map_id", mapId)
      .eq("worry_id", worryId)
      .maybeSingle();
    const { error } = existing
      ? await supabase
          .from("itc_commitments")
          .update({ text, depth_score: 3, rubric_reason: null, sharpen_text: null, suggested_fix: null })
          .eq("id", existing.id)
      : await supabase
          .from("itc_commitments")
          .insert({ map_id: mapId, worry_id: worryId, text, depth_score: 3, attempts: 1 });
    if (error) throw new Error(`ensureDeepCommitments(${worryId}): ${error.message}`);
  }
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

  it(
    "regression a: no reply-thread affordance exists (postThreadReply is not exported)",
    async () => {
      // Structural check: the entry-thread reply pipeline was removed
      // because it invited users to type entry corrections into a chat
      // reply where the coach reaction misinterpreted them as edits.
      // Under Form-First the only ways to change the map are: edit the
      // entry input directly, tap a chip, or ask via the dock. No fourth
      // affordance may exist.
      const actions = await import("@/app/itc/actions");
      expect(
        (actions as Record<string, unknown>).postThreadReply,
        "postThreadReply must not be exported — it invited reply-as-edit misuse",
      ).toBeUndefined();
    },
    5_000,
  );

  it(
    "regression b: editing the goal from behaviors stage updates the map and no stage_note carries the stale text",
    async () => {
      const supabase = createSupabaseServiceClient();
      const oldGoal =
        "I'm committed to getting better at jumping jacks";
      const newGoal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";

      // Start at goal stage; save the (bad) goal.
      const gfd1 = new FormData();
      gfd1.set("map_id", ctx.mapId);
      gfd1.set("text", oldGoal);
      // Use hard-fail LLM so we don't wait on live coach and don't
      // pollute stage_notes with LLM-generated content.
      const model = makeHardFailModel();
      setMainModelOverride(model);
      setUtilityModelOverride(model);
      expect((await saveGoal(gfd1)).ok).toBe(true);

      // Advance to behaviors via the real action.
      const { advanceToStage } = await import("@/app/itc/actions");
      const adv = new FormData();
      adv.set("map_id", ctx.mapId);
      adv.set("to", "behaviors");
      const advRes = await advanceToStage(adv);
      expect(
        advRes.ok,
        `advance to behaviors failed: ${advRes.ok ? "" : advRes.reason}`,
      ).toBe(true);

      // Edit the goal from the behaviors stage.
      const gfd2 = new FormData();
      gfd2.set("map_id", ctx.mapId);
      gfd2.set("text", newGoal);
      expect((await saveGoal(gfd2)).ok).toBe(true);

      // DB now holds the new goal.
      const { data: mapRow } = await supabase
        .from("itc_maps")
        .select("improvement_goal, current_stage")
        .eq("id", ctx.mapId)
        .single();
      expect(mapRow?.improvement_goal).toBe(newGoal);
      expect(mapRow?.current_stage).toBe("behaviors");

      // No persisted stage_note may carry the old goal text (the stale
      // quote bug). Under Form-First A3 the stage intro is client-side
      // and interpolates live map state, so no persisted note should
      // reference the goal at all — but the strong assertion is that
      // no message content contains the old goal.
      const { data: msgs } = await supabase
        .from("itc_messages")
        .select("content, surface, role")
        .eq("map_id", ctx.mapId);
      const stalePersisted = (msgs ?? []).filter(
        (m) =>
          typeof m.content === "string" && m.content.includes("jumping jacks"),
      );
      expect(
        stalePersisted.length,
        `no persisted message may quote the prior goal; found ${stalePersisted.length}`,
      ).toBe(0);

      // And the entry_edited turn event was recorded with stage_at_edit.
      const { data: events } = await supabase
        .from("itc_turn_events")
        .select("event_type, payload")
        .eq("map_id", ctx.mapId)
        .eq("event_type", "entry_edited");
      const goalEdit = (events ?? []).find(
        (e) =>
          typeof e.payload === "object" &&
          e.payload !== null &&
          (e.payload as Record<string, unknown>).kind === "goal",
      );
      expect(goalEdit, "entry_edited(kind=goal) must be logged").toBeDefined();
      expect(
        (goalEdit!.payload as Record<string, unknown>).stage_at_edit,
      ).toBe("behaviors");
    },
    30_000,
  );

  it(
    "regression c: worry excavation loop — shallow blocks Continue, deep unblocks",
    async () => {
      // Real LLMs — the rubric and reaction must both actually fire.
      // Seed a goal + one selected behavior, then advance to worries.
      const supabase = createSupabaseServiceClient();

      // Schema probe: this test writes to depth_score + attempts, added
      // by migration 20260818000004_reinstate_depth_and_attempts.sql.
      // If those columns aren't on the target DB yet, skip cleanly
      // rather than failing on a schema-cache error.
      const probe = await supabase
        .from("itc_worries")
        .select("attempts, depth_score")
        .limit(1);
      if (probe.error) {
        console.warn(
          "[regression c] skipping: schema missing — apply migration 20260818000004. Probe error: %s",
          probe.error.message,
        );
        return;
      }

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

      // Three behaviors — the map's min-3 rule for behaviors → worries.
      for (const text of [
        "I bring up things she did in the past",
        "I lie to get myself out of admitting she's right",
        "I go silent for the rest of the day",
      ]) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", text);
        expect((await addBehavior(fd)).ok).toBe(true);
      }
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id, text")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);
      const behaviorId = bs![0].id as string;

      const advW = new FormData();
      advW.set("map_id", ctx.mapId);
      advW.set("to", "worries");
      expect((await advanceToStage(advW)).ok).toBe(true);

      // Pre-populate the other two worries directly in the DB with
      // depth_score=3 so the pairing + depth gates for those aren't
      // what's being tested here. Regression c isolates the excavation
      // loop on the FIRST behavior's worry.
      for (const b of (bs ?? []).slice(1)) {
        const { error } = await supabase.from("itc_worries").insert({
          map_id: ctx.mapId,
          behavior_id: b.id,
          text: "That I would prove I'm the man who can never be enough for her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed worry for ${b.id} failed: ${error?.message}`).toBeNull();
      }

      // 1. Save a shallow worry. Rubric should score low; gate should block.
      // Stored text is normalized onto the "I worry that" stem.
      const shallowText = "I'm afraid of wasting time.";
      const shallowStored = "I worry that I'd be wasting time.";
      const w1 = new FormData();
      w1.set("map_id", ctx.mapId);
      w1.set("behavior_id", behaviorId);
      w1.set("text", shallowText);
      const w1Res = await saveWorry(w1);
      expect(
        w1Res.ok,
        `saveWorry (shallow) should succeed: ${w1Res.ok ? "" : w1Res.reason}`,
      ).toBe(true);

      const { data: worryRowsShallow } = await supabase
        .from("itc_worries")
        .select("id, text, depth_score, attempts, sharpen_text")
        .eq("map_id", ctx.mapId)
        .eq("behavior_id", behaviorId);
      expect(worryRowsShallow?.length).toBe(1);
      const shallowWorry = worryRowsShallow![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
        sharpen_text: string | null;
      };
      expect(shallowWorry.text).toBe(shallowStored);
      // The rubric may return 0-1 for this text; guard both bounds.
      expect(
        shallowWorry.depth_score,
        "shallow worry should be scored below 2/3",
      ).not.toBeNull();
      expect(shallowWorry.depth_score! < 2).toBe(true);
      expect(shallowWorry.attempts).toBe(1);

      // The coach's line lands on the row itself (the "What to fix"
      // box), not in an entry thread. Populated ⇒ needs sharpening.
      expect(
        shallowWorry.sharpen_text,
        "shallow worry must carry the coach's what's-off line on the row",
      ).toBeTruthy();

      // Gate: worries → commitments must be disabled with depth reason.
      const blockedGate = await getAdvanceGate(ctx.mapId);
      expect(blockedGate.from).toBe("worries");
      expect(blockedGate.enabled).toBe(false);
      expect(blockedGate.reason ?? "").toMatch(/depth/i);

      // 2. Edit to a deep worry. attempts should be 2; score should go up.
      const deepText =
        "That she'll finally see I've been faking it my whole marriage and stop trusting me, and I'll have proved I'm the man who breaks the family the way I was broken.";
      const w2 = new FormData();
      w2.set("map_id", ctx.mapId);
      w2.set("behavior_id", behaviorId);
      w2.set("text", deepText);
      expect((await saveWorry(w2)).ok).toBe(true);

      const { data: worryRowsDeep } = await supabase
        .from("itc_worries")
        .select("id, text, depth_score, attempts")
        .eq("map_id", ctx.mapId)
        .eq("behavior_id", behaviorId);
      expect(worryRowsDeep?.length).toBe(1);
      const deepWorry = worryRowsDeep![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
      };
      // Normalized onto the stem: "That she'll…" → "I worry that she'll…".
      expect(deepWorry.text).toBe(`I worry that ${deepText.replace(/^That\s+/, "")}`);
      expect(deepWorry.attempts).toBe(2);
      expect(
        deepWorry.depth_score,
        "deep worry must be scored 2 or 3",
      ).not.toBeNull();
      expect(deepWorry.depth_score! >= 2).toBe(true);

      // Gate: with a passing worry (3/3, OR 2/3 with attempts>=2), the
      // gate must now be enabled.
      const openGate = await getAdvanceGate(ctx.mapId);
      expect(openGate.from).toBe("worries");
      expect(
        openGate.enabled,
        `gate should open on deep worry (score=${deepWorry.depth_score}, attempts=${deepWorry.attempts}); reason: ${openGate.reason}`,
      ).toBe(true);

      // rubric_scored event should have fired twice.
      const { data: rubricEvents } = await supabase
        .from("itc_turn_events")
        .select("payload")
        .eq("map_id", ctx.mapId)
        .eq("event_type", "rubric_scored");
      expect(
        (rubricEvents?.length ?? 0) >= 2,
        "rubric_scored should have logged once per worry save",
      ).toBe(true);
    },
    120_000,
  );

  it(
    "regression u: behaviors excavation loop — shallow blocks Continue, deep unblocks",
    async () => {
      // Mirror of regression c one column upstream. Guards the
      // behaviors depth branch in computeAdvanceGate (added when
      // itc_behaviors gained depth_score/attempts/rubric_reason). If
      // someone reverts to the old count-only gate on behaviors, this
      // test catches it — otherwise the coach could flag "sharpen
      // behavior #2" and the Continue-to-Worries button would stay
      // enabled (the exact bug the migration fixed).
      const supabase = createSupabaseServiceClient();

      // Schema probe: depth_score + attempts + rubric_reason on
      // itc_behaviors come from migration 20260823000001. Skip cleanly
      // if not applied.
      const probe = await supabase
        .from("itc_behaviors")
        .select("attempts, depth_score, rubric_reason")
        .limit(1);
      if (probe.error) {
        console.warn(
          "[regression u] skipping: schema missing — apply migration 20260823000001. Probe error: %s",
          probe.error.message,
        );
        return;
      }

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

      // Seed 3 selected behaviors via addBehavior. The real rubric
      // scores each. Use texts we expect to pass 3/3 so the count
      // gate + depth gate both open initially.
      const deepTexts = [
        "I bring up things she did in the past instead of listening",
        "I stop talking and walk out of the room mid-conversation",
        "I raise my voice and start explaining why she's wrong",
      ];
      for (const text of deepTexts) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", text);
        expect((await addBehavior(fd)).ok).toBe(true);
      }
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id, text, depth_score, attempts")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);
      const testBehaviorId = bs![0].id as string;

      // The other two behaviors: force to depth_score=3 in case the
      // real rubric happened to score one of them low. This isolates
      // the assertion on the FIRST behavior — same pattern as
      // regression c uses for worries.
      for (const b of (bs ?? []).slice(1)) {
        const { error } = await supabase
          .from("itc_behaviors")
          .update({ depth_score: 3, attempts: 1 })
          .eq("id", b.id);
        expect(
          error,
          `seed depth=3 for ${b.id} failed: ${error?.message}`,
        ).toBeNull();
      }

      // 1. Edit the first behavior to a shallow (aspirational)
      //    version. is_first_person_action_not_aspiration should
      //    fail — "I want to X" is a wish, not an observable move.
      const shallowText = "I want to be more patient with her";
      const upd1 = new FormData();
      upd1.set("map_id", ctx.mapId);
      upd1.set("behavior_id", testBehaviorId);
      upd1.set("text", shallowText);
      expect((await updateBehavior(upd1)).ok).toBe(true);

      const { data: rowsShallow } = await supabase
        .from("itc_behaviors")
        .select("id, text, depth_score, attempts, rubric_reason")
        .eq("id", testBehaviorId);
      expect(rowsShallow?.length).toBe(1);
      const shallow = rowsShallow![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
        rubric_reason: string | null;
      };
      expect(shallow.text).toBe(shallowText);
      expect(
        shallow.depth_score,
        "shallow aspirational behavior should be scored",
      ).not.toBeNull();
      expect(
        shallow.depth_score! < 2,
        `shallow behavior should score below 2/3 (got ${shallow.depth_score}); rubric_reason: ${shallow.rubric_reason}`,
      ).toBe(true);

      // Gate: behaviors → worries must be disabled with depth reason.
      const blockedGate = await getAdvanceGate(ctx.mapId);
      expect(blockedGate.from).toBe("behaviors");
      expect(blockedGate.enabled).toBe(false);
      expect(blockedGate.reason ?? "").toMatch(/depth/i);

      // 2. Edit back to a deep (concrete, observable, first-person,
      //    works-against-goal) version. Rubric should score >= 2.
      const deepText =
        "I interrupt her mid-sentence and cite something she did two years ago";
      const upd2 = new FormData();
      upd2.set("map_id", ctx.mapId);
      upd2.set("behavior_id", testBehaviorId);
      upd2.set("text", deepText);
      expect((await updateBehavior(upd2)).ok).toBe(true);

      const { data: rowsDeep } = await supabase
        .from("itc_behaviors")
        .select("id, text, depth_score, attempts")
        .eq("id", testBehaviorId);
      const deep = rowsDeep![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
      };
      expect(deep.text).toBe(deepText);
      // Two updateBehavior calls → attempts should be 2 or 3
      // (addBehavior counts as 1, each updateBehavior bumps).
      expect(deep.attempts).toBeGreaterThanOrEqual(2);
      expect(
        deep.depth_score,
        "deep behavior must score >= 2",
      ).not.toBeNull();
      expect(deep.depth_score! >= 2).toBe(true);

      // Gate: with all three behaviors passing depth (2/3+attempts>=2
      // or 3/3), the gate must open.
      const openGate = await getAdvanceGate(ctx.mapId);
      expect(openGate.from).toBe("behaviors");
      expect(
        openGate.enabled,
        `behaviors gate should open (score=${deep.depth_score}, attempts=${deep.attempts}); reason: ${openGate.reason}`,
      ).toBe(true);

      // rubric_scored event should have fired for every behavior
      // save (3 adds + 2 edits = 5 minimum).
      const { data: rubricEvents } = await supabase
        .from("itc_turn_events")
        .select("payload")
        .eq("map_id", ctx.mapId)
        .eq("event_type", "rubric_scored");
      const behaviorRubricEvents = (rubricEvents ?? []).filter(
        (e) =>
          e.payload !== null &&
          (e.payload as Record<string, unknown>).kind === "behavior",
      );
      expect(
        behaviorRubricEvents.length >= 5,
        `rubric_scored(kind=behavior) should fire once per save (expected >=5, got ${behaviorRubricEvents.length})`,
      ).toBe(true);
    },
    180_000,
  );

  it(
    "regression v: gate fails-open on null depth_score across all four columns",
    async () => {
      // worryPassesDepth(null, _) === true is unit-tested, but each
      // computeAdvanceGate branch calls the helper independently. If
      // someone inlines a `depth_score !== null &&` check in one
      // branch, the unit test still passes but the fail-open invariant
      // silently regresses for that column. This asserts the
      // integration wiring per column.
      //
      // Fail-open matters because: (a) migration backfill leaves
      // pre-existing rows at depth_score=null, (b) LLM outages
      // (Haiku hiccup) leave rows unscored, (c) regression 5+7
      // depends on it to complete the coach-service-down map.
      const supabase = createSupabaseServiceClient();

      // Schema probes for all four columns.
      for (const table of ["itc_behaviors", "itc_worries", "itc_commitments", "itc_assumptions"]) {
        const probe = await supabase
          .from(table)
          .select("depth_score, attempts")
          .limit(1);
        if (probe.error) {
          console.warn(
            "[regression v] skipping: schema missing on %s — %s",
            table,
            probe.error.message,
          );
          return;
        }
      }

      // Behaviors: seed 3 behaviors with depth_score=null.
      await supabase
        .from("itc_maps")
        .update({
          current_stage: "behaviors",
          improvement_goal:
            "I'm committed to getting better at being present with my wife.",
        })
        .eq("id", ctx.mapId);
      const behaviorInserts = [
        "I bring up things she did in the past",
        "I stop talking mid-conversation",
        "I raise my voice",
      ];
      const behaviorIds: string[] = [];
      for (let i = 0; i < behaviorInserts.length; i++) {
        const { data, error } = await supabase
          .from("itc_behaviors")
          .insert({
            map_id: ctx.mapId,
            text: behaviorInserts[i],
            source: "user",
            sort_order: i,
            selected: true,
            depth_score: null,
            attempts: 1,
          })
          .select("id")
          .single();
        expect(error, `seed behavior ${i} failed: ${error?.message}`).toBeNull();
        behaviorIds.push(data!.id as string);
      }
      const behGate = await getAdvanceGate(ctx.mapId);
      expect(behGate.from).toBe("behaviors");
      expect(
        behGate.enabled,
        `behaviors gate must open with null depth_score (fail-open); reason: ${behGate.reason}`,
      ).toBe(true);

      // Worries: advance, seed one worry per behavior with null score.
      await supabase
        .from("itc_maps")
        .update({ current_stage: "worries" })
        .eq("id", ctx.mapId);
      const worryIds: string[] = [];
      for (const bId of behaviorIds) {
        const { data, error } = await supabase
          .from("itc_worries")
          .insert({
            map_id: ctx.mapId,
            behavior_id: bId,
            text: "That I would prove I'm the man who breaks the family.",
            depth_score: null,
            attempts: 1,
          })
          .select("id")
          .single();
        expect(error, `seed worry for ${bId}: ${error?.message}`).toBeNull();
        worryIds.push(data!.id as string);
      }
      const worryGate = await getAdvanceGate(ctx.mapId);
      expect(worryGate.from).toBe("worries");
      expect(
        worryGate.enabled,
        `worries gate must open with null depth_score (fail-open); reason: ${worryGate.reason}`,
      ).toBe(true);

      // Commitments: advance, seed one commitment per worry with null score.
      await supabase
        .from("itc_maps")
        .update({ current_stage: "commitments" })
        .eq("id", ctx.mapId);
      const commitmentIds: string[] = [];
      for (const wId of worryIds) {
        const { data, error } = await supabase
          .from("itc_commitments")
          .insert({
            map_id: ctx.mapId,
            worry_id: wId,
            text: "I'm also committed to keeping her past mistakes available so mine are never the only thing on the table.",
            depth_score: null,
            attempts: 1,
          })
          .select("id")
          .single();
        expect(error, `seed commitment for ${wId}: ${error?.message}`).toBeNull();
        commitmentIds.push(data!.id as string);
      }
      const cGate = await getAdvanceGate(ctx.mapId);
      expect(cGate.from).toBe("commitments");
      expect(
        cGate.enabled,
        `commitments gate must open with null depth_score (fail-open); reason: ${cGate.reason}`,
      ).toBe(true);

      // Assumptions: advance, seed one assumption + link to every
      // commitment (assumptions gate needs coverage).
      await supabase
        .from("itc_maps")
        .update({ current_stage: "assumptions" })
        .eq("id", ctx.mapId);
      const { data: aRow, error: aErr } = await supabase
        .from("itc_assumptions")
        .insert({
          map_id: ctx.mapId,
          text: "I assume that if I let her past mistakes go, I'll have failed as the husband who protects the family.",
          sort_order: 0,
          depth_score: null,
          attempts: 1,
        })
        .select("id")
        .single();
      expect(aErr, `seed assumption: ${aErr?.message}`).toBeNull();
      const assumptionId = aRow!.id as string;
      for (const cId of commitmentIds) {
        const { error: linkErr } = await supabase
          .from("itc_assumption_commitments")
          .insert({
            assumption_id: assumptionId,
            commitment_id: cId,
          });
        expect(linkErr, `link assumption→commitment: ${linkErr?.message}`).toBeNull();
      }
      const aGate = await getAdvanceGate(ctx.mapId);
      expect(aGate.from).toBe("assumptions");
      expect(
        aGate.enabled,
        `assumptions gate must open with null depth_score (fail-open); reason: ${aGate.reason}`,
      ).toBe(true);
    },
    30_000,
  );

  it(
    "regression d: commitment excavation loop — noble blocks Continue, self-protective unblocks",
    async () => {
      // Real LLMs (rubric + reaction). Mirror of regression c on
      // Column 4. Seed goal + 3 behaviors + 3 worries (all deep) +
      // advance to commitments. Pre-populate two commitments at
      // depth 3 so the assertion isolates on the first.
      const supabase = createSupabaseServiceClient();

      // Schema probe — depth_score + attempts on itc_commitments come
      // from migration 20260818000005. Skip cleanly if not applied.
      const probe = await supabase
        .from("itc_commitments")
        .select("attempts, depth_score")
        .limit(1);
      if (probe.error) {
        console.warn(
          "[regression d] skipping: schema missing — apply migration 20260818000005. Probe error: %s",
          probe.error.message,
        );
        return;
      }

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

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
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);

      const advW = new FormData();
      advW.set("map_id", ctx.mapId);
      advW.set("to", "worries");
      expect((await advanceToStage(advW)).ok).toBe(true);

      // Seed 3 deep worries directly in the DB (bypass saveWorry to
      // save LLM cost — this test is about commitments).
      for (const b of bs ?? []) {
        const { error } = await supabase.from("itc_worries").insert({
          map_id: ctx.mapId,
          behavior_id: b.id,
          text: "That I would prove I'm the man who can never be enough for her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed worry for ${b.id} failed: ${error?.message}`).toBeNull();
      }

      const advC = new FormData();
      advC.set("map_id", ctx.mapId);
      advC.set("to", "commitments");
      const advCRes = await advanceToStage(advC);
      expect(
        advCRes.ok,
        `advance to commitments failed: ${advCRes.ok ? "" : advCRes.reason}`,
      ).toBe(true);

      const { data: ws } = await supabase
        .from("itc_worries")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      expect(ws?.length).toBe(3);
      const worryId = ws![0].id as string;

      // Advance auto-derived a commitment per worry. Bring the other
      // two to depth 3 so the gate assertion is exclusively about the
      // first commitment.
      await ensureDeepCommitments(
        ctx.mapId,
        (ws ?? []).slice(1).map((w) => w.id as string),
        "I'm also committed to never being the man she finds out is never enough for her.",
      );

      // 1. Save a noble commitment. Rubric should score low; gate
      // should block on depth.
      const nobleText = "I'm committed to being the best husband I can be.";
      const c1 = new FormData();
      c1.set("map_id", ctx.mapId);
      c1.set("worry_id", worryId);
      c1.set("text", nobleText);
      const c1Res = await saveCommitment(c1);
      expect(
        c1Res.ok,
        `saveCommitment (noble) should succeed: ${c1Res.ok ? "" : c1Res.reason}`,
      ).toBe(true);

      const { data: shallowRows } = await supabase
        .from("itc_commitments")
        .select("id, text, depth_score, attempts, sharpen_text")
        .eq("map_id", ctx.mapId)
        .eq("worry_id", worryId);
      expect(shallowRows?.length).toBe(1);
      const shallowRow = shallowRows![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
        sharpen_text: string | null;
      };
      // saveCommitment normalizes onto the "I'm also committed to" stem.
      expect(shallowRow.text).toMatch(/^I'm also committed to/);
      expect(shallowRow.text).toContain("being the best husband I can be");
      expect(shallowRow.depth_score, "noble commitment should score below 2/3").not.toBeNull();
      expect(shallowRow.depth_score! < 2).toBe(true);
      // One save on top of the auto-derived row (or a first save when
      // the drafter left the worry bare): attempts counts every write.
      expect(shallowRow.attempts).toBeGreaterThanOrEqual(1);
      expect(
        shallowRow.sharpen_text,
        "noble commitment must carry the coach's what's-off line on the row",
      ).toBeTruthy();

      const blockedGate = await getAdvanceGate(ctx.mapId);
      expect(blockedGate.from).toBe("commitments");
      expect(blockedGate.enabled).toBe(false);
      expect(blockedGate.reason ?? "").toMatch(/depth/i);

      // 2. Edit to a deep self-protective commitment. attempts=2;
      // score should reach 2 or 3 and the gate opens.
      const deepText =
        "I'm also committed to never being the husband she finds out has been faking it the whole marriage.";
      const c2 = new FormData();
      c2.set("map_id", ctx.mapId);
      c2.set("worry_id", worryId);
      c2.set("text", deepText);
      expect((await saveCommitment(c2)).ok).toBe(true);

      const { data: deepRows } = await supabase
        .from("itc_commitments")
        .select("id, text, depth_score, attempts")
        .eq("map_id", ctx.mapId)
        .eq("worry_id", worryId);
      expect(deepRows?.length).toBe(1);
      const deepRow = deepRows![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
      };
      expect(deepRow.text).toBe(deepText);
      expect(deepRow.attempts).toBe(shallowRow.attempts + 1);
      expect(deepRow.depth_score, "deep commitment must be scored 2 or 3").not.toBeNull();
      expect(deepRow.depth_score! >= 2).toBe(true);

      const openGate = await getAdvanceGate(ctx.mapId);
      expect(openGate.from).toBe("commitments");
      expect(
        openGate.enabled,
        `gate should open on deep commitment (score=${deepRow.depth_score}, attempts=${deepRow.attempts}); reason: ${openGate.reason}`,
      ).toBe(true);
    },
    120_000,
  );

  it(
    "regression e: assumption excavation loop — shallow blocks Continue, deep unblocks",
    async () => {
      // Real LLMs. Mirror of regressions c + d on Column 5. Seed the
      // full map up to commitments via direct DB, then run save →
      // rubric → gate on the assumption.
      const supabase = createSupabaseServiceClient();

      // Reuse the commitments-schema probe as a proxy for 000005
      // being applied; the assumption schema (000004) is already
      // required by regression c so if we got here it's live.
      const probe = await supabase
        .from("itc_commitments")
        .select("attempts, depth_score")
        .limit(1);
      if (probe.error) {
        console.warn(
          "[regression e] skipping: schema missing — apply migrations 000004 + 000005. Probe error: %s",
          probe.error.message,
        );
        return;
      }

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

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
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);

      const advW = new FormData();
      advW.set("map_id", ctx.mapId);
      advW.set("to", "worries");
      expect((await advanceToStage(advW)).ok).toBe(true);

      for (const b of bs ?? []) {
        const { error } = await supabase.from("itc_worries").insert({
          map_id: ctx.mapId,
          behavior_id: b.id,
          text: "That I would prove I'm the man who can never be enough for her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed worry ${error?.message}`).toBeNull();
      }

      const advC = new FormData();
      advC.set("map_id", ctx.mapId);
      advC.set("to", "commitments");
      expect((await advanceToStage(advC)).ok).toBe(true);

      const { data: ws } = await supabase
        .from("itc_worries")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      expect(ws?.length).toBe(3);

      // Advance auto-derived a commitment per worry; bring all three
      // to depth 3 (pre-scored) so only the assumption is under test.
      await ensureDeepCommitments(
        ctx.mapId,
        (ws ?? []).map((w) => w.id as string),
        "I'm also committed to never being the man she finds out is never enough for her.",
      );

      const advA = new FormData();
      advA.set("map_id", ctx.mapId);
      advA.set("to", "assumptions");
      const advARes = await advanceToStage(advA);
      expect(
        advARes.ok,
        `advance to assumptions failed: ${advARes.ok ? "" : advARes.reason}`,
      ).toBe(true);

      const { data: cs } = await supabase
        .from("itc_commitments")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      expect(cs?.length).toBe(3);

      // 1. Save a shallow assumption (forecast, not identity). It
      // should score low and every commitment it doesn't underwrite
      // is orphaned — gate should block on either depth OR pairing.
      // We link it to ALL three commitments so pairing is satisfied
      // and only depth can block.
      const shallowText =
        "If I don't bring up her past, the argument will just take longer.";
      const a1 = new FormData();
      a1.set("map_id", ctx.mapId);
      a1.set("text", shallowText);
      for (const c of cs ?? []) a1.append("commitment_ids", c.id);
      const a1Res = await saveAssumption(a1);
      expect(
        a1Res.ok,
        `saveAssumption (shallow) should succeed: ${a1Res.ok ? "" : a1Res.reason}`,
      ).toBe(true);

      const { data: shallowRows } = await supabase
        .from("itc_assumptions")
        .select("id, text, depth_score, attempts, sharpen_text")
        .eq("map_id", ctx.mapId);
      expect(shallowRows?.length).toBe(1);
      const shallowRow = shallowRows![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
        sharpen_text: string | null;
      };
      // saveAssumption prepends the "I assume that" stem.
      expect(shallowRow.text).toMatch(/^I assume that/i);
      expect(shallowRow.text).toContain("the argument will just take longer");
      expect(shallowRow.depth_score, "shallow assumption should score below 2").not.toBeNull();
      expect(shallowRow.depth_score! < 2).toBe(true);
      expect(shallowRow.attempts).toBe(1);
      expect(
        shallowRow.sharpen_text,
        "shallow assumption must carry the coach's what's-off line on the row",
      ).toBeTruthy();

      const blockedGate = await getAdvanceGate(ctx.mapId);
      expect(blockedGate.from).toBe("assumptions");
      expect(blockedGate.enabled).toBe(false);
      expect(blockedGate.reason ?? "").toMatch(/depth/i);

      // Verify all three links exist.
      const { data: linksAfterInsert } = await supabase
        .from("itc_assumption_commitments")
        .select("assumption_id, commitment_id")
        .eq("assumption_id", shallowRow.id);
      expect(linksAfterInsert?.length).toBe(3);

      // 2. Edit to a deep assumption. Also drop one link to prove
      // link-update round-trips: only two commitments underwritten
      // now, so gate should block on pairing (the third commitment
      // is uncovered).
      const deepText =
        "I assume that if I let her see who I really am, then she'd walk and I'd be the man who was never enough for his wife or his kids.";
      const a2 = new FormData();
      a2.set("map_id", ctx.mapId);
      a2.set("assumption_id", shallowRow.id);
      a2.set("text", deepText);
      a2.append("commitment_ids", (cs ?? [])[0].id);
      a2.append("commitment_ids", (cs ?? [])[1].id);
      expect((await saveAssumption(a2)).ok).toBe(true);

      const { data: deepRows } = await supabase
        .from("itc_assumptions")
        .select("id, text, depth_score, attempts")
        .eq("map_id", ctx.mapId);
      expect(deepRows?.length).toBe(1);
      const deepRow = deepRows![0] as {
        id: string;
        text: string;
        depth_score: number | null;
        attempts: number;
      };
      expect(deepRow.text).toMatch(/^I assume that/i);
      expect(deepRow.attempts).toBe(2);
      expect(deepRow.depth_score, "deep assumption should score 2 or 3").not.toBeNull();
      expect(deepRow.depth_score! >= 2).toBe(true);

      const { data: linksAfterEdit } = await supabase
        .from("itc_assumption_commitments")
        .select("commitment_id")
        .eq("assumption_id", deepRow.id);
      expect(linksAfterEdit?.length).toBe(2);

      // Pairing gate now blocks (one commitment uncovered).
      const pairingBlocked = await getAdvanceGate(ctx.mapId);
      expect(pairingBlocked.from).toBe("assumptions");
      expect(pairingBlocked.enabled).toBe(false);
      expect(pairingBlocked.reason ?? "").toMatch(/commitment/i);

      // 3. Reattach the third link so pairing is satisfied AND depth
      // passes → gate opens.
      const a3 = new FormData();
      a3.set("map_id", ctx.mapId);
      a3.set("assumption_id", shallowRow.id);
      a3.set("text", deepText);
      for (const c of cs ?? []) a3.append("commitment_ids", c.id);
      expect((await saveAssumption(a3)).ok).toBe(true);

      const openGate = await getAdvanceGate(ctx.mapId);
      expect(openGate.from).toBe("assumptions");
      expect(
        openGate.enabled,
        `gate should open when depth and pairing both pass; reason: ${openGate.reason}`,
      ).toBe(true);
    },
    180_000,
  );

  it(
    "regression f: saveGoal refuses to prepend the stem onto competing goal framing",
    async () => {
      // Prior bug: user typed "I want to get better at being with my
      // wife. Help me" INSTEAD of the required stem; saveGoal blindly
      // prepended and stored "I'm committed to getting better at I
      // want to get better at being with my wife. Help me". Regression
      // locks in that saveGoal now rejects competing framing with a
      // clear error and does NOT mangle the stored goal.
      const model = makeHardFailModel();
      setMainModelOverride(model);
      setUtilityModelOverride(model);

      const cases = [
        "I want to get better at being with my wife.",
        "I would like to spend more time with my kids",
        "My goal is to work out three times a week",
        "Help me be a better father",
        "I need to stop working late",
        "I plan to call my brother every Sunday",
      ];
      for (const text of cases) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", text);
        const res = await saveGoal(fd);
        expect(
          res.ok,
          `saveGoal should reject competing framing "${text}"`,
        ).toBe(false);
        if (!res.ok) {
          expect(res.reason).toMatch(/committed/i);
        }
      }

      // The stored goal must be untouched (still null — no successful
      // save happened).
      const supabase = createSupabaseServiceClient();
      const { data: mapRow } = await supabase
        .from("itc_maps")
        .select("improvement_goal")
        .eq("id", ctx.mapId)
        .single();
      expect(mapRow?.improvement_goal ?? null).toBeNull();

      // Sanity: a plain fresh phrase with the stem still works and is
      // NOT mashed (single stem, exact user suffix).
      const goodFd = new FormData();
      goodFd.set("map_id", ctx.mapId);
      goodFd.set(
        "text",
        "I'm committed to getting better at being present when my wife is upset with me",
      );
      const goodRes = await saveGoal(goodFd);
      expect(
        goodRes.ok,
        `saveGoal should accept stemmed goal: ${goodRes.ok ? "" : goodRes.reason}`,
      ).toBe(true);
      const { data: after } = await supabase
        .from("itc_maps")
        .select("improvement_goal")
        .eq("id", ctx.mapId)
        .single();
      expect(after?.improvement_goal).toBe(
        "I'm committed to getting better at being present when my wife is upset with me",
      );
      // Not a double-stem.
      expect(
        (after?.improvement_goal ?? "").split(
          /i'?m committed to getting better at/i,
        ).length,
      ).toBe(2); // split by stem → exactly two segments = one stem
    },
    30_000,
  );

  it(
    "regression g: itc-chip-fill event carries a target discriminator",
    async () => {
      // Prior bug: tapping a Column 1 goal chip filled BOTH the goal
      // input AND the Column 2 Add-a-behavior form, because the
      // window-scoped itc-chip-fill event had no target. Fix: every
      // dispatch now includes { target: "goal"|"behavior"|... } and
      // listeners filter by target.
      //
      // Structural check: the source of both dispatchers +
      // both listeners must reference `target` in their event
      // payload / filter, and the listeners must guard against
      // wrong-target events.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..", "..");

      const files = [
        "src/app/itc/[mapId]/entry-thread.tsx",
        "src/app/itc/[mapId]/map-canvas.tsx",
        "src/app/itc/[mapId]/goal-row.tsx",
        "src/app/itc/[mapId]/behaviors-row.tsx",
      ];
      const contents: Record<string, string> = {};
      for (const f of files) {
        contents[f] = readFileSync(resolve(repoRoot, f), "utf8");
      }

      // Dispatchers include `target` in the event detail. Multiline
      // regex tolerates ternary/object-shorthand variants.
      const dispatchRe =
        /new CustomEvent\(\s*["']itc-chip-fill["'][\s\S]{0,300}?target/;
      expect(
        dispatchRe.test(contents["src/app/itc/[mapId]/entry-thread.tsx"]),
        "entry-thread.tsx dispatch must include target in detail",
      ).toBe(true);
      expect(
        dispatchRe.test(contents["src/app/itc/[mapId]/map-canvas.tsx"]),
        "map-canvas.tsx dispatch must include target in detail",
      ).toBe(true);

      // Listeners filter by target — required so goal chips don't
      // fill the behavior form and vice versa.
      expect(
        /e\.detail\.target\s*!==\s*["']goal["']/.test(
          contents["src/app/itc/[mapId]/goal-row.tsx"],
        ),
        "goal-row.tsx must filter itc-chip-fill to target === 'goal'",
      ).toBe(true);
      expect(
        /e\.detail\.target\s*!==\s*["']behavior["']/.test(
          contents["src/app/itc/[mapId]/behaviors-row.tsx"],
        ),
        "behaviors-row.tsx must filter itc-chip-fill to target === 'behavior'",
      ).toBe(true);
    },
    5_000,
  );

  it(
    "regression h: entry threads only render on the active section (locked-in columns are quiet)",
    async () => {
      // Prior bug: after advancing from Column 1 to Column 2, the
      // goal's coach thread (jumping-jacks pushback + approval
      // acknowledgment) still showed in Column 1. Rule: once a stage
      // is locked in, its thread disappears; the entry text is the
      // only durable artifact.
      //
      // Under the feedback-above-input layout the goal thread lives
      // in map-canvas (single input), while per-item threads for
      // behaviors/worries/commitments/assumptions live INSIDE their
      // row components and render above each item's textarea. Both
      // paths must stay guarded.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..", "..");
      const read = (rel: string) =>
        readFileSync(resolve(repoRoot, rel), "utf8");

      const mapCanvas = read("src/app/itc/[mapId]/map-canvas.tsx");
      const behaviorsRow = read("src/app/itc/[mapId]/behaviors-row.tsx");
      const worriesRow = read("src/app/itc/[mapId]/worries-row.tsx");
      const commitmentsRow = read("src/app/itc/[mapId]/commitments-row.tsx");
      const assumptionsRow = read("src/app/itc/[mapId]/assumptions-row.tsx");

      // 1. Goal thread in map-canvas must be guarded by
      //    map.current_stage === "goal".
      expect(
        /map\.current_stage\s*===\s*["']goal["'][\s\S]{0,600}?<EntryThread[\s\S]{0,400}?chipTarget="goal"/.test(
          mapCanvas,
        ),
        "goal <EntryThread> in map-canvas must be guarded by map.current_stage === 'goal'",
      ).toBe(true);

      // 2. Each row file has exactly one <EntryThread> render,
      //    positioned above the item's input (thread.length > 0 gate
      //    ensures empty state renders no thread).
      const rowFiles: Array<[string, string, string]> = [
        ["behavior", behaviorsRow, "src/app/itc/[mapId]/behaviors-row.tsx"],
        ["worry", worriesRow, "src/app/itc/[mapId]/worries-row.tsx"],
        [
          "commitment",
          commitmentsRow,
          "src/app/itc/[mapId]/commitments-row.tsx",
        ],
        [
          "assumption",
          assumptionsRow,
          "src/app/itc/[mapId]/assumptions-row.tsx",
        ],
      ];
      for (const [kind, src, path] of rowFiles) {
        const matches = [
          ...src.matchAll(/<EntryThread[\s\S]{0,300}?chipTarget="(\w+)"/g),
        ];
        expect(matches.length, `${path} must render exactly one <EntryThread>`).toBe(1);
        expect(
          matches[0][1],
          `${path}'s <EntryThread> chipTarget must be "${kind}"`,
        ).toBe(kind);
        // Guarded by thread.length > 0 (or thread.length !== 0) so
        // the item without a reaction still shows the input alone.
        expect(
          /thread\.length\s*(?:>\s*0|!==?\s*0)[\s\S]{0,200}?<EntryThread/.test(
            src,
          ),
          `${path}'s <EntryThread> must be guarded by thread.length check`,
        ).toBe(true);
      }

      // 3. Non-active stages get an empty threads map — enforced in
      //    map-canvas by wrapping the population in
      //    `if (map.current_stage === "<stage>")` guards.
      for (const stage of [
        "behaviors",
        "worries",
        "commitments",
        "assumptions",
      ]) {
        expect(
          new RegExp(
            `map\\.current_stage\\s*===\\s*["']${stage}["'][\\s\\S]{0,400}?threadFor`,
          ).test(mapCanvas),
          `map-canvas ${stage} threads must be populated only when stage is active`,
        ).toBe(true);
      }
    },
    5_000,
  );

  it(
    "regression i: entry coaching never offers a menu (menus are Give-me-ideas's job)",
    async () => {
      // Prior bug: on adding behavior #2, the reaction returned 4
      // suggestion chips (inconsistent — didn't happen on #1) and
      // several of them near-duplicated what the user already added.
      // Fix: reactions are refinement-only; the multi-item menu is
      // exclusively the "Give me ideas" pipeline.
      //
      // Verify with the real LLM: seed a goal + advance to behaviors,
      // add a behavior via saveWorry's cousin action addBehavior,
      // then read back the coach reaction message and assert its
      // parsed chip payload has no `suggestions` (or an empty array).
      const supabase = createSupabaseServiceClient();
      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

      // Add two behaviors so we exercise the same path where the
      // prior bug fired on the second addition.
      for (const text of [
        "I bring up things she did in the past instead of listening",
        "I shut down and walk out of the room",
      ]) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", text);
        expect((await addBehavior(fd)).ok).toBe(true);
      }

      // The invariant is unchanged: nothing outside Give-me-ideas
      // hands the coachee a MENU of entry texts. Where it lives moved.
      // LLM entry_thread reactions were retired for the deterministic
      // fix box, so there is no chip payload left to inspect. The
      // guarantee is now structural: a row carries at most ONE
      // rewrite, in `suggested_fix`, a single column of text that
      // cannot hold a list.
      const { data: reactions } = await supabase
        .from("itc_messages")
        .select("content")
        .eq("map_id", ctx.mapId)
        .eq("role", "assistant")
        .eq("surface", "entry_thread")
        .eq("entry_ref_table", "itc_behaviors");
      expect(
        reactions?.length ?? 0,
        "behavior entry_thread reactions were retired 2026-09-01; coaching lives on the row (sharpen_text / suggested_fix). A reaction here means the retired LLM path came back.",
      ).toBe(0);

      const { data: rows } = await supabase
        .from("itc_behaviors")
        .select("text, suggested_fix")
        .eq("map_id", ctx.mapId);
      expect(rows?.length ?? 0).toBe(2);
      for (const r of rows ?? []) {
        const fix = r.suggested_fix as string | null;
        if (fix === null) continue;
        expect(typeof fix, "suggested_fix must be one rewrite, not a list").toBe(
          "string",
        );
        // One sentence, not an enumerated menu smuggled into a string.
        expect(
          /^\s*(?:[-*\u2022]|\d[.)])\s/m.test(fix),
          `suggested_fix must not be a bulleted or numbered menu; got: ${fix}`,
        ).toBe(false);
      }
    },
    90_000,
  );

  it(
    "regression j: Give-me-ideas suggestions never duplicate an existing on-map entry",
    async () => {
      // Prior bug: after adding two behaviors, tapping Give-me-ideas
      // returned 4 suggestions that near-mirrored those behaviors.
      // Fix: generateSuggestions now feeds existing entries into the
      // prompt and post-filters by normalized-text dedup.
      const supabase = createSupabaseServiceClient();
      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage, requestSuggestions } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

      const existingTexts = [
        "I bring up things she did in the past instead of listening",
        "I shut down and walk out of the room",
      ];
      for (const text of existingTexts) {
        const fd = new FormData();
        fd.set("map_id", ctx.mapId);
        fd.set("text", text);
        expect((await addBehavior(fd)).ok).toBe(true);
      }

      // Tap Give-me-ideas for behaviors.
      const sfd = new FormData();
      sfd.set("map_id", ctx.mapId);
      sfd.set("kind", "behavior");
      const sRes = await requestSuggestions(sfd);
      expect(
        sRes.ok,
        `requestSuggestions failed: ${sRes.ok ? "" : sRes.reason}`,
      ).toBe(true);

      // Suggestions live on the resulting stage_note message's fenced
      // payload. Fetch the most recent stage_note assistant message
      // on the behaviors stage and inspect chips.
      const { data: notes } = await supabase
        .from("itc_messages")
        .select("content, created_at")
        .eq("map_id", ctx.mapId)
        .eq("role", "assistant")
        .eq("surface", "stage_note")
        .eq("stage_at_creation", "behaviors")
        .order("created_at", { ascending: false })
        .limit(1);
      expect(notes?.length).toBe(1);
      const content = notes![0].content as string;
      const fence = /\n?```coach-chips\s*\n([\s\S]*?)\n```\s*$/;
      const match = content.match(fence);
      expect(
        match,
        "suggestions message must carry a coach-chips payload",
      ).not.toBeNull();
      const chips = JSON.parse(match![1]) as { suggestions?: string[] };
      expect(
        (chips.suggestions ?? []).length,
        "at least one suggestion should survive the dedup filter",
      ).toBeGreaterThan(0);

      // Normalized-text dedup: no suggestion may match an existing
      // behavior when compared case-insensitively with punctuation /
      // whitespace collapsed.
      const norm = (s: string) =>
        s
          .trim()
          .toLowerCase()
          .replace(/[\u2018\u2019\u02BC]/g, "'")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[.!?]+$/, "")
          .replace(/\s+/g, " ");
      const existingNormalized = new Set(existingTexts.map(norm));
      for (const s of chips.suggestions ?? []) {
        expect(
          existingNormalized.has(norm(s)),
          `suggestion "${s}" duplicates an existing behavior`,
        ).toBe(false);
      }
    },
    90_000,
  );

  it(
    "regression l: coach rejects identity/aspirational/vague behaviors, and says why on the row",
    async () => {
      // Behavior-column parallel to regression k. Column 2 requires
      // observable moves that CLEARLY work against the Column 1 goal.
      // These variants should not be Case-3 approved:
      //   - identity claim: "I'm a bad listener"
      //   - aspirational:   "I need to be more patient"
      //   - vague verb:     "I withdraw"
      // Assert the coach's reaction on each is Case-2-shaped
      // (refinement chip OR a probing question).
      const supabase = createSupabaseServiceClient();

      const badBehaviors = [
        "I'm a bad listener",
        "I need to be more patient with my wife",
        "I withdraw",
      ];

      for (const text of badBehaviors) {
        const { participantId, mapId } = await seedParticipantAndMap();
        try {
          // Seed goal + advance to behaviors.
          const goal =
            "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
          const gfd = new FormData();
          gfd.set("map_id", mapId);
          gfd.set("text", goal);
          expect((await saveGoal(gfd)).ok).toBe(true);

          const { advanceToStage } = await import("@/app/itc/actions");
          const advB = new FormData();
          advB.set("map_id", mapId);
          advB.set("to", "behaviors");
          expect((await advanceToStage(advB)).ok).toBe(true);

          // Save the bad behavior.
          const bfd = new FormData();
          bfd.set("map_id", mapId);
          bfd.set("text", text);
          const bRes = await addBehavior(bfd);
          expect(
            bRes.ok,
            `addBehavior failed for "${text}": ${bRes.ok ? "" : bRes.reason}`,
          ).toBe(true);

          // The judge that catches these moved from an LLM reaction
          // to scoreBehaviorDepth, whose verdict is persisted on the
          // row. Same three failure modes, same rejection, one judge:
          //   "I'm a bad listener"            -> identity label
          //   "I need to be more patient"     -> aspiration
          //   "I withdraw"                    -> vague, not observable
          const { data: bs } = await supabase
            .from("itc_behaviors")
            .select("id, depth_score, sharpen_text")
            .eq("map_id", mapId);
          expect(bs?.length).toBe(1);
          const row = bs![0];
          expect(
            row.depth_score as number | null,
            `no depth verdict landed for bad behavior "${text}"`,
          ).not.toBeNull();
          expect(
            (row.depth_score as number) < 3,
            `bad behavior "${text}" must not score a clean 3; got ${row.depth_score}`,
          ).toBe(true);

          // And the coachee must be told, in the coach's own words,
          // on the row itself. A silent low score is the same false
          // approval this regression was written to catch.
          const content = (row.sharpen_text as string | null) ?? "";
          const hasRefinement = content.trim().length > 0;
          const hasQuestion = content.includes("?");
          expect(
            hasRefinement || hasQuestion,
            `bad behavior "${text}" scored low but told the coachee nothing; sharpen_text was empty. Got: ${content}`,
          ).toBe(true);
        } finally {
          await cleanup(participantId);
        }
      }
    },
    240_000,
  );

  it(
    "regression m: advance to commitments auto-derives a non-noble competing commitment per worry",
    async () => {
      // On advance into the commitments stage, the server pipeline
      // AUTO-DERIVES a competing commitment for each worry that
      // doesn't already have one, writing straight to
      // itc_commitments.text (no draft/accept step). Assertion: every
      // worry gets a real commitment, and each commitment passes the
      // commitment rubric at 2/3 or better (i.e., the coach's own
      // auto-derivations clear the same non-noble bar the user has to
      // clear when editing).
      const supabase = createSupabaseServiceClient();

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

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
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);

      const advW = new FormData();
      advW.set("map_id", ctx.mapId);
      advW.set("to", "worries");
      expect((await advanceToStage(advW)).ok).toBe(true);

      // Seed 3 deep worries directly so the depth gate opens.
      for (const b of bs ?? []) {
        const { error } = await supabase.from("itc_worries").insert({
          map_id: ctx.mapId,
          behavior_id: b.id,
          text: "That I would prove I'm the man who can never be enough for her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed worry: ${error?.message}`).toBeNull();
      }

      // Advance to commitments — this triggers the draft pipeline.
      const advC = new FormData();
      advC.set("map_id", ctx.mapId);
      advC.set("to", "commitments");
      const advCRes = await advanceToStage(advC);
      expect(
        advCRes.ok,
        `advance to commitments: ${advCRes.ok ? "" : advCRes.reason}`,
      ).toBe(true);

      // Every worry must now have a paired REAL commitment (not a
      // draft) written straight to itc_commitments.
      const { data: worries } = await supabase
        .from("itc_worries")
        .select("id, text")
        .eq("map_id", ctx.mapId);
      expect(worries?.length).toBe(3);
      const { data: commitments } = await supabase
        .from("itc_commitments")
        .select("id, worry_id, text")
        .eq("map_id", ctx.mapId);
      expect(commitments?.length).toBe(3);
      const commitmentByWorryId = new Map(
        (commitments ?? []).map((c) => [c.worry_id as string, c]),
      );
      for (const w of worries ?? []) {
        const c = commitmentByWorryId.get(w.id);
        expect(
          c,
          `worry "${w.text}" must have a paired commitment after advance to commitments`,
        ).toBeTruthy();
        // Commitment text must start with "I'm (also) committed to"
        // (per ensureCommitmentStem + the drafter's non-noble shape).
        expect(
          /^i\s*(?:'|\u2019)?m\s+(?:also\s+)?committed\s+to/i.test(
            (c?.text ?? "").trim(),
          ),
          `commitment must start with "I'm committed to": "${c?.text}"`,
        ).toBe(true);
      }

      // Score each auto-derived commitment against the SAME criteria
      // the hone auditor runs — depth rubric AND the interior-witness
      // regex. Different bars between drafter and auditor create the
      // "coach talks at cross-purposes" bug (system generates commitment
      // X, then audit says X is bad). The drafter has its own verify-
      // retry loop against these checks in draftCommitmentForWorry.
      const { scoreCommitmentDepth } = await import("@/lib/itc/rubric");
      const { checkInteriorWitnessInCommitments } = await import(
        "@/lib/itc/criteria/commitments"
      );
      for (const w of worries ?? []) {
        const c = commitmentByWorryId.get(w.id);
        const scored = await scoreCommitmentDepth({
          goalText: goal,
          worryText: w.text,
          commitmentText: c?.text as string,
        });
        expect(
          scored.score >= 2,
          `auto-derived commitment for worry "${w.text}" scored ${scored.score}/3 — must be ≥ 2. Commitment: "${c?.text}". Rubric reason: ${scored.reason}`,
        ).toBe(true);
        const iwFindings = await checkInteriorWitnessInCommitments({
          commitments: [
            {
              id: c!.id as string,
              map_id: ctx.mapId,
              worry_id: w.id,
              text: c!.text as string,
              depth_score: null,
              rubric_reason: null,
              mirrors_worry_identity: null,
              attempts: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(
          iwFindings.length,
          `auto-derived commitment fired the interior-witness regex — drafter and auditor bar out of sync. Commitment: "${c?.text}"`,
        ).toBe(0);
      }
    },
    240_000,
  );

  it(
    "regression n: downstream columns are locked until the coachee advances into them",
    async () => {
      // Structural check: map-canvas passes isLocked to each row
      // based on stageIndex comparison. Each row file short-circuits
      // to a "Complete previous columns first"-style placeholder when
      // locked. If a future refactor drops the guard, this trips.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..", "..");
      const read = (rel: string) =>
        readFileSync(resolve(repoRoot, rel), "utf8");

      const mapCanvas = read("src/app/itc/[mapId]/map-canvas.tsx");
      // 1. map-canvas computes isLocked via stageIndex comparison
      //    and passes it to each row.
      expect(
        /isLocked\s*=\s*\(\s*rowStage[\s\S]{0,200}?stageIndex/.test(mapCanvas),
        "map-canvas must compute isLocked via stageIndex comparison",
      ).toBe(true);
      // 2. Each of the four multi-column rows receives isLocked.
      for (const rowJsx of [
        "<BehaviorsRow",
        "<WorriesRow",
        "<CommitmentsRow",
        "<AssumptionsRow",
      ]) {
        const re = new RegExp(
          `${rowJsx}[\\s\\S]{0,400}?isLocked=\\{isLocked\\(`,
        );
        expect(
          re.test(mapCanvas),
          `${rowJsx} must be passed isLocked={isLocked("<stage>")}`,
        ).toBe(true);
      }
      // 3. Each row file short-circuits when isLocked with a
      //    "Complete ... first" placeholder that hides all inputs.
      const rowFiles: Array<[string, string, RegExp]> = [
        [
          "behaviors-row.tsx",
          read("src/app/itc/[mapId]/behaviors-row.tsx"),
          /if\s*\(\s*isLocked\s*\)[\s\S]{0,300}?Complete the goal first/i,
        ],
        [
          "worries-row.tsx",
          read("src/app/itc/[mapId]/worries-row.tsx"),
          /if\s*\(\s*isLocked\s*\)[\s\S]{0,300}?Complete behaviors first/i,
        ],
        [
          "commitments-row.tsx",
          read("src/app/itc/[mapId]/commitments-row.tsx"),
          /if\s*\(\s*isLocked\s*\)[\s\S]{0,300}?Complete worries first/i,
        ],
        [
          "assumptions-row.tsx",
          read("src/app/itc/[mapId]/assumptions-row.tsx"),
          /if\s*\(\s*isLocked\s*\)[\s\S]{0,300}?Complete competing commitments first/i,
        ],
      ];
      for (const [name, src, re] of rowFiles) {
        expect(
          re.test(src),
          `${name} must short-circuit with the correct locked placeholder`,
        ).toBe(true);
      }
    },
    5_000,
  );

  it(
    "regression k: role-identity goals are named as such before the man writes one",
    async () => {
      // Prior bug: "I'm committed to getting better at being a
      // husband" sailed through with a bare acknowledgment, even
      // though it fails Kegan/Lahey's Column 1 specificity bar (a
      // role, not a way of acting).
      //
      // The LLM goal reaction that used to catch this was retired
      // 2026-08-31 (see saveGoal: "the shared criteria module owns
      // all goal coaching now"). Nothing scores the goal at save
      // time any more, so the bar has to be stated BEFORE he writes,
      // in the goal stage intro, which is the surface that replaced
      // the reaction. This test holds that surface to the bar.
      //
      // If a goal-level judge is ever reintroduced, extend this test
      // to assert its verdict too rather than replacing this half:
      // the intro should keep saying it either way.
      const { STAGE_INTROS } = await import("@/lib/itc/stage-intros");
      const intro = STAGE_INTROS.goal!({ goal: null, pillarCode: "A" });

      expect(
        /a role/i.test(intro),
        `goal intro must name the role-vs-way-of-acting distinction; got: ${intro}`,
      ).toBe(true);
      // The worked contrast has to be concrete enough to copy, and it
      // has to use one of the role nouns men actually type.
      expect(
        /(husband|father|leader)/i.test(intro),
        `goal intro must show a real role-goal example; got: ${intro}`,
      ).toBe(true);
      expect(
        /way of acting|you'd know the moment/i.test(intro),
        `goal intro must say what to write instead of a role; got: ${intro}`,
      ).toBe(true);
      // And it must not simply forbid: Appendix A asks for a
      // behavioral pattern, so the intro shows one.
      expect(intro).toMatch(/Staying in the room/i);
    },
    10_000,
  );
  it(
    "regression o: worry input placeholder is polarity-safe for both doing and not-doing behaviors",
    async () => {
      // Prior bug: worry-row's placeholder was "What are you afraid
      // would happen if you stopped?" — which asks the coachee to
      // imagine stopping the behavior. That framing breaks for
      // not-doing behaviors ("I don't listen to her"): "if you stopped
      // not-listening" is a double negative that pushes the coachee
      // toward practical concerns instead of felt fear. The stage
      // prompt (src/lib/itc/prompts/stages/worries.ts) already spells
      // out the fix: frame the imagination as "did the opposite",
      // which works for both polarities.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..", "..");
      const src = readFileSync(
        resolve(repoRoot, "src/app/itc/[mapId]/worries-row.tsx"),
        "utf8",
      );
      expect(
        /placeholder=["'][^"']*if you stopped/i.test(src),
        "worry placeholder must not use 'if you stopped' (breaks for not-doing behaviors)",
      ).toBe(false);

      // The polarity guarantee moved 2026-09-02. It used to live in
      // the placeholder, which asked the coachee to imagine "if you
      // did the opposite". The box is now PRE-FILLED by the server
      // with "I worry that if I <counter-move>, " (draftWorryOpening),
      // so the placeholder is a fallback he rarely sees and the
      // counter-move itself is what has to be polarity-safe. That is
      // a stronger guarantee than a hint in grey text: the server
      // writes the affirmative act rather than asking him to invert
      // a negative in his head.
      const coachSrc = readFileSync(
        resolve(repoRoot, "src/lib/itc/coach.ts"),
        "utf8",
      );
      expect(
        /For a not-doing behavior[^\n]*affirmative act/i.test(coachSrc),
        "worry opening drafter must turn a not-doing behavior into an affirmative act",
      ).toBe(true);
      expect(
        /NEVER "stopped not-/i.test(coachSrc),
        "worry opening drafter must forbid the 'stopped not-asking' double negative",
      ).toBe(true);
    },
    5_000,
  );

  it(
    "regression p: advance to assumptions drafts nothing — the man writes his own",
    async () => {
      // This regression used to assert the opposite: that advancing
      // into assumptions clustered the commitments and persisted 2-6
      // coach-drafted Big Assumptions, each forced into canonical
      // "I assume that if I …, then …" form.
      //
      // Both halves were retired 2026-09-02, for separate reasons
      // found on live maps:
      //
      //   1. Drafting them backfired. Handed a pre-written
      //      assumption, men edited it into a restatement of the
      //      worry they had written one column up, which is the one
      //      thing Column 5 must not be. The coach now offers
      //      nothing on advance and the man supplies the belief.
      //
      //   2. The mandatory if-then shape was never the guides' bar.
      //      Kegan & Lahey Vol 1 p 19 answer their own quiz: of the
      //      twelve assumptions listed, only 6, 7 and 10 are not
      //      testable. Items 1, 2 and 9 carry no "if" and no "then"
      //      and are fine, with worked tests in Appendix D. Item 7
      //      is a clean if-then landing on identity and they reject
      //      it. See src/lib/itc/__tests__/assumption-shape.test.ts.
      //
      // The coverage drafter (fixCoverage in src/lib/itc/fixes.ts)
      // is deliberately still live and is NOT what this locks: it
      // fires only for a commitment no assumption covers, which is a
      // gap in his own map rather than a blank column.
      const supabase = createSupabaseServiceClient();

      // Schema probe — itc_assumption_drafts table added in migration
      // 20260819000002. Skip cleanly if not applied.
      const probe = await supabase
        .from("itc_assumption_drafts")
        .select("id")
        .limit(1);
      if (probe.error) {
        console.warn(
          "[regression p] skipping: schema missing — apply migration 20260819000002. Probe error: %s",
          probe.error.message,
        );
        return;
      }

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

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
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);

      const advW = new FormData();
      advW.set("map_id", ctx.mapId);
      advW.set("to", "worries");
      expect((await advanceToStage(advW)).ok).toBe(true);

      for (const b of bs ?? []) {
        const { error } = await supabase.from("itc_worries").insert({
          map_id: ctx.mapId,
          behavior_id: b.id,
          text: "That I would prove I'm the man who can never be enough for her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed worry ${error?.message}`).toBeNull();
      }

      const advC = new FormData();
      advC.set("map_id", ctx.mapId);
      advC.set("to", "commitments");
      expect((await advanceToStage(advC)).ok).toBe(true);

      const { data: ws } = await supabase
        .from("itc_worries")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      expect(ws?.length).toBe(3);

      // Seed three deep commitments pre-scored so the gate opens.
      const seededCommitmentTexts = [
        "I'm committed to never letting her see the parts of me I'd have to disown.",
        "I'm committed to never having to admit I was the one who got it wrong.",
        "I'm committed to never sitting in the discomfort of her being upset with me.",
      ];
      for (let i = 0; i < (ws?.length ?? 0); i++) {
        const { error } = await supabase.from("itc_commitments").insert({
          map_id: ctx.mapId,
          worry_id: ws![i].id,
          text: seededCommitmentTexts[i],
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed commitment ${error?.message}`).toBeNull();
      }

      // Advance to assumptions. This used to trigger the draft
      // pipeline; it must now leave the column empty.
      const advA = new FormData();
      advA.set("map_id", ctx.mapId);
      advA.set("to", "assumptions");
      const advARes = await advanceToStage(advA);
      expect(
        advARes.ok,
        `advance to assumptions: ${advARes.ok ? "" : advARes.reason}`,
      ).toBe(true);


      // The column must be empty. He writes the first one.
      const { data: drafts } = await supabase
        .from("itc_assumption_drafts")
        .select("id, text")
        .eq("map_id", ctx.mapId);
      expect(
        drafts?.length ?? 0,
        `advance to assumptions must draft nothing; got ${drafts?.length ?? 0}: ${JSON.stringify((drafts ?? []).map((d) => d.text))}`,
      ).toBe(0);

      const { data: assumptions } = await supabase
        .from("itc_assumptions")
        .select("id")
        .eq("map_id", ctx.mapId);
      expect(
        assumptions?.length ?? 0,
        "advance to assumptions must not write assumptions either",
      ).toBe(0);

      // Structural locks so a refactor can't quietly bring the
      // advance-time pipeline back through another door.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..", "..");

      // (a) Column 5 gets no opening either. The worry column gets
      // one because the counter-move is the half the server is
      // reliably right about; the belief has no such half.
      const coachSrc = readFileSync(
        resolve(repoRoot, "src/lib/itc/coach.ts"),
        "utf8",
      );
      expect(
        /export async function draftAssumptionOpening\b/.test(coachSrc),
        "draftAssumptionOpening was retired; a prefix made men restate the worry",
      ).toBe(false);

      // (b) The row must not render a draft-accept affordance. Match
      // JSX text between tags so historical doc comments referencing
      // the retired card don't trip this.
      const rowSrc = readFileSync(
        resolve(repoRoot, "src/app/itc/[mapId]/assumptions-row.tsx"),
        "utf8",
      );
      expect(
        />\s*Use this draft\s*</i.test(rowSrc),
        "assumptions-row must not render a 'Use this draft' button",
      ).toBe(false);
    },
    240_000,
  );
  it(
    "regression r: commitments are auto-derived, no draft/accept UI",
    async () => {
      // Prior UX (retired 2026-08-31): commitments landed as "coach's
      // drafts" and required a "Use this draft" click before becoming
      // real commitment.text. That was structurally the same pattern
      // as worries and assumptions but it read as an extra step
      // coachees didn't need — per ITC methodology, competing
      // commitments are a mechanical non-noble transformation of the
      // worry, so the coach can just do it.
      //
      // New model:
      //   1. On advance to commitments, the server derives each one
      //      straight to itc_commitments.text.
      //   2. On any worry edit, saveWorry re-derives the paired
      //      commitment automatically.
      //
      // This test structurally locks BOTH properties so a future
      // refactor can't quietly re-introduce a drafts path.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..", "..");
      const rowSrc = readFileSync(
        resolve(repoRoot, "src/app/itc/[mapId]/commitments-row.tsx"),
        "utf8",
      );
      // (a) No "Use this draft" button anywhere in commitments-row.
      // Match JSX-text-between-tags shape so historical doc comments
      // that reference the retired button don't trip this check.
      expect(
        />\s*Use this draft\s*</i.test(rowSrc),
        "commitments-row must not render a 'Use this draft' button — commitments are auto-derived, not drafts",
      ).toBe(false);
      // (b) No live read of the coach_commitment_draft field. Allow
      // comments to mention it historically; forbid property access.
      expect(
        /\.coach_commitment_draft\b/.test(rowSrc),
        "commitments-row must not read coach_commitment_draft — the column is dropped",
      ).toBe(false);

      // (c) saveWorry must fire the auto-derive helper on edits.
      const actionsSrc = readFileSync(
        resolve(repoRoot, "src/app/itc/actions.ts"),
        "utf8",
      );
      const saveWorryBlock = actionsSrc.match(
        /export async function saveWorry[\s\S]*?\n\}/,
      );
      expect(
        saveWorryBlock,
        "saveWorry action must exist",
      ).toBeTruthy();
      expect(
        /autoDeriveCommitmentForWorry\s*\(/.test(saveWorryBlock![0]),
        "saveWorry must call autoDeriveCommitmentForWorry so a worry edit re-syncs its paired commitment",
      ).toBe(true);

      // (d) draftCommitmentForWorry's verify loop must check the SAME
      // criteria the hone auditor runs — otherwise the drafter can
      // produce commitments its own audit will reject, and the coach
      // ends up talking at cross-purposes.
      //
      // Bound the region between the function opener and the NEXT
      // top-level `// ---` divider (coach.ts's function separator) so
      // nested function braces don't truncate the match.
      const coachSrc = readFileSync(
        resolve(repoRoot, "src/lib/itc/coach.ts"),
        "utf8",
      );
      const drafterBlock = coachSrc.match(
        /export async function draftCommitmentForWorry[\s\S]*?(?=\n\/\/ ---)/,
      );
      expect(
        drafterBlock,
        "draftCommitmentForWorry must exist (and coach.ts must divide functions with `// ---` for the regex bound)",
      ).toBeTruthy();
      expect(
        /checkInteriorWitnessInCommitments/.test(drafterBlock![0]),
        "draftCommitmentForWorry's verify loop must run checkInteriorWitnessInCommitments (same check the hone auditor uses)",
      ).toBe(true);
      expect(
        /mirrors_worry_identity/.test(drafterBlock![0]),
        "draftCommitmentForWorry's verify loop must check mirrors_worry_identity (same check the hone auditor uses)",
      ).toBe(true);

      // (e) The same alignment invariant used to be asserted on the
      // WORRIES drafter: its verify loop had to run
      // checkInteriorWitnessInWorries, the exact regex the hone
      // auditor runs, so it could not produce "I'd have to see I…"
      // text that passed depth and got flagged later.
      //
      // That drafter was deleted 2026-09-03. The app no longer writes
      // an identity landing for Column 3 at all — draftWorryOpening
      // writes "I worry that if I <counter-move>, " and stops — so
      // there is no generated text for the auditor to disagree with.
      // The invariant is satisfied by absence, which is stronger than
      // by agreement, and the absence is what this now asserts.
      expect(
        /export async function draftWorryForBehavior/.test(coachSrc),
        "the worry drafter was deleted; nothing should author a Column 3 identity again",
      ).toBe(false);
      expect(
        /export async function draftWorryOpening/.test(coachSrc),
        "draftWorryOpening is what replaced it",
      ).toBe(true);
    },
    5_000,
  );

  it(
    "regression q: Continue-to-immune-system button reads 'Show Me What's Going On'",
    async () => {
      // The assumptions → immune_system transition is the reveal
      // moment — the "gas + brake" walkthrough where the coach shows
      // how the columns interlock. A generic "Continue to Immune
      // System" label undersells that beat. This is a small UX
      // affordance the user asked for; lock it in structurally so a
      // future refactor of computeAdvanceGate can't quietly regress
      // the copy.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolve(here, "..", "..");
      const src = readFileSync(
        resolve(repoRoot, "src/app/itc/actions.ts"),
        "utf8",
      );
      // Must special-case immune_system with the reveal-moment label.
      expect(
        /to\s*===\s*["']immune_system["'][\s\S]{0,120}?Show Me What's Going On/i
          .test(src),
        "actions.ts must set label to \"Show Me What's Going On\" when to === \"immune_system\"",
      ).toBe(true);
    },
    5_000,
  );

  it(
    "regression s: advance to immune_system delivers the three-movement walkthrough and flips walkthrough_delivered",
    async () => {
      // Pre-fix bug: clicking Continue at assumptions transitioned the
      // stage to immune_system but no walkthrough fired and
      // walkthrough_delivered stayed false forever — Continue-to-
      // Prioritize sat disabled with "Deliver the walkthrough first."
      // The old marker-based delivery ("<<mark_walkthrough_delivered>>")
      // was ripped out under Form-First and never re-plumbed. This
      // regression locks the new server-orchestrated delivery so it
      // can't silently regress.
      const supabase = createSupabaseServiceClient();

      // Advancing to assumptions requires the assumption drafts schema
      // (migration 20260819000002). Use it as the probe.
      const probe = await supabase
        .from("itc_assumption_drafts")
        .select("id")
        .limit(1);
      if (probe.error) {
        console.warn(
          "[regression s] skipping: schema missing — apply migrations 20260819000001 + 20260819000002. Probe error: %s",
          probe.error.message,
        );
        return;
      }

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

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
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("sort_order");
      expect(bs?.length).toBe(3);

      const advW = new FormData();
      advW.set("map_id", ctx.mapId);
      advW.set("to", "worries");
      expect((await advanceToStage(advW)).ok).toBe(true);

      for (const b of bs ?? []) {
        const { error } = await supabase.from("itc_worries").insert({
          map_id: ctx.mapId,
          behavior_id: b.id,
          text: "That I would prove I'm the man who can never be enough for her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed worry ${error?.message}`).toBeNull();
      }

      const advC = new FormData();
      advC.set("map_id", ctx.mapId);
      advC.set("to", "commitments");
      expect((await advanceToStage(advC)).ok).toBe(true);

      const { data: ws } = await supabase
        .from("itc_worries")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      expect(ws?.length).toBe(3);

      // Seed 3 deep commitments so the depth gate opens.
      for (const w of ws ?? []) {
        const { error } = await supabase.from("itc_commitments").insert({
          map_id: ctx.mapId,
          worry_id: w.id,
          text: "I'm committed to never having to see I'm the husband who keeps failing her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error, `seed commitment ${error?.message}`).toBeNull();
      }

      const advA = new FormData();
      advA.set("map_id", ctx.mapId);
      advA.set("to", "assumptions");
      expect((await advanceToStage(advA)).ok).toBe(true);

      // Seed 1 deep assumption + link to all commitments so the
      // walkthrough has coverage to render.
      const { data: cs } = await supabase
        .from("itc_commitments")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      const { data: aRow } = await supabase
        .from("itc_assumptions")
        .insert({
          map_id: ctx.mapId,
          text:
            "I assume that if I let her see how many times I've failed her, then she'd finally see I'm not the husband she deserves.",
          depth_score: 3,
          attempts: 1,
          sort_order: 0,
        })
        .select("id")
        .single();
      expect(aRow?.id).toBeTruthy();
      for (const c of cs ?? []) {
        const { error } = await supabase
          .from("itc_assumption_commitments")
          .insert({ assumption_id: aRow!.id, commitment_id: c.id });
        expect(error).toBeNull();
      }

      // Baseline: walkthrough_delivered should be false before advance.
      const { data: mapBefore } = await supabase
        .from("itc_maps")
        .select("walkthrough_delivered")
        .eq("id", ctx.mapId)
        .single();
      expect(mapBefore?.walkthrough_delivered).toBe(false);

      // Advance to immune_system — this triggers the walkthrough.
      const advI = new FormData();
      advI.set("map_id", ctx.mapId);
      advI.set("to", "immune_system");
      const advIRes = await advanceToStage(advI);
      expect(
        advIRes.ok,
        `advance to immune_system: ${advIRes.ok ? "" : advIRes.reason}`,
      ).toBe(true);

      // Flag must be set.
      const { data: mapAfter } = await supabase
        .from("itc_maps")
        .select("walkthrough_delivered")
        .eq("id", ctx.mapId)
        .single();
      expect(
        mapAfter?.walkthrough_delivered,
        "walkthrough_delivered must flip to true after advance to immune_system",
      ).toBe(true);

      // A stage-note message must be persisted on the immune_system
      // stage, anchored to itc_maps, carrying the walkthrough prose.
      const { data: notes } = await supabase
        .from("itc_messages")
        .select("content, surface, entry_ref_table, entry_ref_id")
        .eq("map_id", ctx.mapId)
        .eq("role", "assistant")
        .eq("surface", "stage_note")
        .eq("stage_at_creation", "immune_system");
      expect(
        (notes?.length ?? 0) >= 1,
        `at least one immune_system stage_note must exist after advance; got ${notes?.length ?? 0}`,
      ).toBe(true);
      const walkthrough = (notes ?? [])
        .map((n) => n.content as string)
        .join("\n");
      // Kegan/Lahey's load-bearing metaphor must appear verbatim
      // (the prompt requires it word-for-word — coachees remember
      // this phrase a year later, per the guide).
      expect(
        /one foot on the gas/i.test(walkthrough) &&
          /one foot on the brake/i.test(walkthrough),
        `walkthrough must contain the "one foot on the gas, one foot on the brake" verbatim: got ${walkthrough}`,
      ).toBe(true);
      // Must reference the coachee's actual improvement goal (grounded
      // in HIS map, not generic ITC theory).
      expect(
        walkthrough.includes(goal) ||
          /being present and calm/i.test(walkthrough),
        `walkthrough must quote or reference the coachee's improvement goal`,
      ).toBe(true);

      // Idempotency: re-advancing to immune_system must NOT generate
      // a second walkthrough.
      const advI2 = new FormData();
      advI2.set("map_id", ctx.mapId);
      advI2.set("to", "immune_system");
      await advanceToStage(advI2);
      const { data: notes2 } = await supabase
        .from("itc_messages")
        .select("id")
        .eq("map_id", ctx.mapId)
        .eq("role", "assistant")
        .eq("surface", "stage_note")
        .eq("stage_at_creation", "immune_system");
      expect(notes2?.length).toBe(notes?.length);
    },
    300_000,
  );

  it(
    "regression t: advance to prioritize delivers the coach's assumption recommendation and pre-selects it",
    async () => {
      // Checkpoint C-δ: on advance into prioritize, the server should
      // (a) call recommendAssumptionToTest for a Kegan-voice pick
      //     with Vol 2 p.268-anchored reasoning,
      // (b) persist the prose as a stage_note anchored to prioritize,
      // (c) pre-select the recommended assumption via
      //     setAssumptionSelected so the Continue-to-Test gate opens
      //     without requiring the user to click first.
      // Coachee can still override by clicking a different assumption
      // in the UI. This regression locks the delivery + pre-selection.
      const supabase = createSupabaseServiceClient();

      const probe = await supabase
        .from("itc_assumption_drafts")
        .select("id")
        .limit(1);
      if (probe.error) {
        console.warn(
          "[regression t] skipping: schema missing — apply migrations 20260819000001 + 20260819000002. Probe error: %s",
          probe.error.message,
        );
        return;
      }

      const goal =
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
      const gfd = new FormData();
      gfd.set("map_id", ctx.mapId);
      gfd.set("text", goal);
      expect((await saveGoal(gfd)).ok).toBe(true);

      const { advanceToStage } = await import("@/app/itc/actions");
      const advB = new FormData();
      advB.set("map_id", ctx.mapId);
      advB.set("to", "behaviors");
      expect((await advanceToStage(advB)).ok).toBe(true);

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
      const { data: bs } = await supabase
        .from("itc_behaviors")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("sort_order");

      const advW = new FormData();
      advW.set("map_id", ctx.mapId);
      advW.set("to", "worries");
      expect((await advanceToStage(advW)).ok).toBe(true);

      for (const b of bs ?? []) {
        const { error } = await supabase.from("itc_worries").insert({
          map_id: ctx.mapId,
          behavior_id: b.id,
          text: "That I would prove I'm the man who can never be enough for her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error).toBeNull();
      }

      const advC = new FormData();
      advC.set("map_id", ctx.mapId);
      advC.set("to", "commitments");
      expect((await advanceToStage(advC)).ok).toBe(true);

      const { data: ws } = await supabase
        .from("itc_worries")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      for (const w of ws ?? []) {
        const { error } = await supabase.from("itc_commitments").insert({
          map_id: ctx.mapId,
          worry_id: w.id,
          text: "I'm committed to never having to see I'm the husband who keeps failing her.",
          depth_score: 3,
          attempts: 1,
        });
        expect(error).toBeNull();
      }

      const advA = new FormData();
      advA.set("map_id", ctx.mapId);
      advA.set("to", "assumptions");
      expect((await advanceToStage(advA)).ok).toBe(true);

      // Seed 2 deep assumptions with commitment coverage so the picker
      // has something meaningful to pick between.
      const { data: cs } = await supabase
        .from("itc_commitments")
        .select("id")
        .eq("map_id", ctx.mapId)
        .order("created_at");
      const assumptionTexts = [
        "I assume that if I stop protecting her from my failures, then she'd see the pattern and I'd be the husband I'm terrified I am.",
        "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her.",
      ];
      const seededAssumptionIds: string[] = [];
      for (let i = 0; i < assumptionTexts.length; i++) {
        const { data: aRow, error } = await supabase
          .from("itc_assumptions")
          .insert({
            map_id: ctx.mapId,
            text: assumptionTexts[i],
            depth_score: 3,
            attempts: 1,
            sort_order: i,
          })
          .select("id")
          .single();
        expect(error).toBeNull();
        expect(aRow?.id).toBeTruthy();
        seededAssumptionIds.push(aRow!.id as string);
      }
      // Link first assumption to commitments 1 & 2, second to
      // commitment 3 (typical shared-root + separate-root pattern).
      for (let i = 0; i < (cs?.length ?? 0); i++) {
        const commitmentId = cs![i].id as string;
        const assumptionId =
          i < 2 ? seededAssumptionIds[0] : seededAssumptionIds[1];
        const { error } = await supabase
          .from("itc_assumption_commitments")
          .insert({
            assumption_id: assumptionId,
            commitment_id: commitmentId,
          });
        expect(error).toBeNull();
      }

      // Advance to immune_system (fires walkthrough — we don't check
      // its content here, regression s covers that).
      const advI = new FormData();
      advI.set("map_id", ctx.mapId);
      advI.set("to", "immune_system");
      expect((await advanceToStage(advI)).ok).toBe(true);

      // Baseline: no assumption selected before advancing to prioritize.
      const { data: assumptionsBefore } = await supabase
        .from("itc_assumptions")
        .select("id, selected_for_testing")
        .eq("map_id", ctx.mapId);
      expect(
        (assumptionsBefore ?? []).some((a) => a.selected_for_testing),
      ).toBe(false);

      // Advance to prioritize — this triggers the recommendation.
      const advP = new FormData();
      advP.set("map_id", ctx.mapId);
      advP.set("to", "prioritize");
      const advPRes = await advanceToStage(advP);
      expect(
        advPRes.ok,
        `advance to prioritize: ${advPRes.ok ? "" : advPRes.reason}`,
      ).toBe(true);

      // A prioritize stage_note must be persisted, anchored to itc_maps.
      const { data: notes } = await supabase
        .from("itc_messages")
        .select("content, surface, entry_ref_table")
        .eq("map_id", ctx.mapId)
        .eq("role", "assistant")
        .eq("surface", "stage_note")
        .eq("stage_at_creation", "prioritize");
      expect(
        (notes?.length ?? 0) >= 1,
        `at least one prioritize stage_note must exist; got ${notes?.length ?? 0}`,
      ).toBe(true);
      const prose = (notes ?? [])
        .map((n) => n.content as string)
        .join("\n");
      // Must reference the coachee's improvement goal or the picked
      // assumption's text (grounded in HIS map, not generic ITC theory).
      expect(
        assumptionTexts.some((t) =>
          prose.includes(t.slice(0, 40)),
        ) || prose.toLowerCase().includes("being present"),
        `recommendation prose must reference his actual assumption text or goal; got: ${prose}`,
      ).toBe(true);

      // Exactly ONE assumption must be pre-selected (setAssumptionSelected
      // enforces one-at-a-time).
      const { data: assumptionsAfter } = await supabase
        .from("itc_assumptions")
        .select("id, selected_for_testing")
        .eq("map_id", ctx.mapId);
      const selected = (assumptionsAfter ?? []).filter(
        (a) => a.selected_for_testing,
      );
      expect(
        selected.length,
        `exactly one assumption must be pre-selected after advance to prioritize; got ${selected.length}`,
      ).toBe(1);

      // The Continue-to-Test gate must now be enabled (walkthrough
      // was delivered in prior step, selection just happened).
      const { getAdvanceGate } = await import("@/app/itc/actions");
      const gate = await getAdvanceGate(ctx.mapId);
      expect(
        gate.enabled,
        `Continue-to-Test gate must be enabled after advance to prioritize; reason: ${gate.reason ?? "(none)"}`,
      ).toBe(true);

      // Idempotency: re-advancing to prioritize must NOT re-fire the
      // recommendation (would overwrite the coachee's selection).
      const advP2 = new FormData();
      advP2.set("map_id", ctx.mapId);
      advP2.set("to", "prioritize");
      await advanceToStage(advP2);
      const { data: notes2 } = await supabase
        .from("itc_messages")
        .select("id")
        .eq("map_id", ctx.mapId)
        .eq("role", "assistant")
        .eq("surface", "stage_note")
        .eq("stage_at_creation", "prioritize");
      expect(notes2?.length).toBe(notes?.length);
    },
    300_000,
  );
});

