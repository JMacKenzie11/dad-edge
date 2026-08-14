"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import {
  looksLikeStructuredOutputLeakage,
  runItcCoachTurn,
  type CoachAction,
} from "@/lib/itc/coach";
import {
  addAssumption,
  addBehavior,
  addCommitment,
  advanceStage,
  appendMessage,
  clearSelectedAssumption,
  countWorryAttempts,
  createMap,
  deleteBehavior,
  deleteMap,
  findInProgressMap,
  getActiveTest,
  getMapById,
  getMapForParticipant,
  linkAssumptionToCommitments,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMessages,
  listTestResults,
  listTests,
  listWorries,
  logWorryAttempt,
  markMapComplete,
  markRevealDelivered,
  markWalkthroughDelivered,
  recordTestResult,
  retagMessageStage,
  saveImprovementGoal,
  saveTestDraft,
  setAssumptionRecommended,
  setAssumptionSelected,
  updateBehaviorText,
  upsertWorry,
} from "@/lib/itc/maps";
import {
  scoreAssumptionDepth,
  scoreCommitmentDepth,
  scoreWorryDepth,
} from "@/lib/itc/rubric";
import {
  coachAcknowledgedNewBehavior,
  extractAssumptionDraft,
  extractCoachBehaviorCount,
  extractCommitmentDrafts,
  extractWorryDraft,
  looksLikeBehaviorCandidate,
} from "@/lib/itc/backstop-extractors";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import {
  ASSUMPTION_STEM,
  COMMITMENT_STEM,
  GOAL_STEM,
  WORRY_STEM,
  ensureStem,
  hasGoalStem,
  type ItcStage,
} from "@/lib/itc/stage";

const startMapSchema = z.object({
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "N"]),
});

export async function startMap(formData: FormData): Promise<void> {
  const participant = await requireItcParticipant();
  const parsed = startMapSchema.safeParse({
    pillar_code: formData.get("pillar_code"),
  });
  if (!parsed.success) redirect("/itc?error=pillar");

  const existing = await findInProgressMap(participant.id);
  if (existing) redirect(`/itc/${existing.id}`);

  const map = await createMap(participant.id, parsed.data.pillar_code as PillarCode);
  const pillar = PILLAR_BY_CODE[map.pillar_code];
  await appendMessage(
    map.id,
    "assistant",
    `Alright. You've picked ${pillar.label} as the pillar. Before we go anywhere else — the map begins with one goal that starts "${GOAL_STEM}...". Do you already have that goal, or want help getting to it?`,
    "goal",
  );
  redirect(`/itc/${map.id}`);
}

const resetMapSchema = z.object({
  map_id: z.string().uuid(),
});

export async function resetMap(formData: FormData): Promise<void> {
  const participant = await requireItcParticipant();
  const parsed = resetMapSchema.safeParse({ map_id: formData.get("map_id") });
  if (!parsed.success) redirect("/itc");

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) redirect("/itc");

  await deleteMap(map.id, participant.id);
  redirect("/itc");
}

const messageSchema = z.object({
  map_id: z.string().uuid(),
  text: z.string().min(1).max(4000),
});

export type SendMessageResult = {
  ok: boolean;
  reason?: string;
};

export async function sendCoachMessage(formData: FormData): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = messageSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid message." };

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };

  return runCoachTurnForMap(map.id, parsed.data.text);
}

/**
 * Core coach-turn processor — everything sendCoachMessage does except
 * auth and participant-ownership checks. Exposed so E2E tests (which
 * skip the cookie-based auth flow) can drive a real map through a full
 * ITC flow without duplicating the applyCoachAction / backstop /
 * cascade / retag pipeline.
 *
 * Loads the map fresh so callers can pass just the id. Returns the
 * same SendMessageResult shape sendCoachMessage returns.
 */
export async function runCoachTurnForMap(
  mapId: string,
  text: string,
): Promise<SendMessageResult> {
  const turnStart = Date.now();
  const map = await getMapById(mapId);
  if (!map) return { ok: false, reason: "Map not found." };

  const parsedText = z.string().min(1).max(4000).safeParse(text);
  if (!parsedText.success) return { ok: false, reason: "Invalid message." };

  // Shim so the pre-existing body below (which was written against
  // `parsed.data.text`) keeps compiling with minimal churn.
  const parsed = { data: { text: parsedText.data } };

  await appendMessage(map.id, "user", parsed.data.text, map.current_stage);

  const [
    history,
    behaviors,
    worries,
    commitments,
    assumptions,
    links,
    tests,
    testResults,
  ] = await Promise.all([
    listMessages(map.id),
    listBehaviors(map.id),
    listWorries(map.id),
    listCommitments(map.id),
    listAssumptions(map.id),
    listAssumptionLinks(map.id),
    listTests(map.id),
    listTestResults(map.id),
  ]);
  const linksByAssumption = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByAssumption.get(l.assumption_id) ?? [];
    arr.push(l.commitment_id);
    linksByAssumption.set(l.assumption_id, arr);
  }
  const assumptionsForCoach = assumptions.map((a) => ({
    id: a.id,
    text: a.text,
    depth_score: a.depth_score,
    selected_for_testing: a.selected_for_testing,
    coach_recommended: a.coach_recommended,
    linked_commitment_ids: linksByAssumption.get(a.id) ?? [],
  }));

  const priorHistory = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Pull the last 3 [action rejected] system messages so the coach's next
  // turn sees the server's feedback (the depth rubric, mostly) and can
  // adjust instead of re-proposing the same rejected content.
  const recentActionFeedback = history
    .filter(
      (m) =>
        m.role === "system" && m.content.startsWith("[action rejected]"),
    )
    .slice(-3)
    .map((m) => m.content);

  const priorAssistantContent = [...priorHistory]
    .reverse()
    .find((m) => m.role === "assistant")?.content ?? null;

  let reply;
  const llmStart = Date.now();
  let llmMs = 0;
  try {
    reply = await runItcCoachTurnWithGuards({
      pillar: map.pillar_code,
      stage: map.current_stage,
      improvementGoal: map.improvement_goal,
      behaviors,
      worries,
      commitments: commitments.map((c) => ({
        id: c.id,
        worry_id: c.worry_id,
        text: c.text,
      })),
      assumptions: assumptionsForCoach,
      walkthroughDelivered: map.walkthrough_delivered,
      tests: tests.map((t) => ({
        id: t.id,
        assumption_id: t.assumption_id,
        test_type: t.test_type,
        assumption_says: t.assumption_says,
        behavior_change: t.behavior_change,
        data_to_collect: t.data_to_collect,
        in_order_to_find_out: t.in_order_to_find_out,
        target_date: t.target_date,
        status: t.status,
      })),
      testResults: testResults.map((r) => ({
        test_id: r.test_id,
        ran_on: r.ran_on,
        what_i_did: r.what_i_did,
        data_collected: r.data_collected,
        what_it_says_about_assumption: r.what_it_says_about_assumption,
        assumption_verdict: r.assumption_verdict,
        next_step: r.next_step,
      })),
      mapStatus: map.status,
      recentActionFeedback,
      history: priorHistory,
      userMessage: parsed.data.text,
      priorAssistantContent,
    });
    llmMs = Date.now() - llmStart;
  } catch (err) {
    llmMs = Date.now() - llmStart;
    const message = err instanceof Error ? err.message : "Coach unavailable.";
    await appendMessage(
      map.id,
      "system",
      `[coach error] ${message} (model=${process.env.ITC_COACH_MODEL || "claude-sonnet-5"})`,
      map.current_stage,
    );
    console.warn(
      "[itc timing] turn map=%s stage=%s llm=%dms total=%dms outcome=coach-error",
      map.id,
      map.current_stage,
      llmMs,
      Date.now() - turnStart,
    );
    return { ok: false, reason: `Coach: ${message}` };
  }

  // If the coach emitted suggest_behaviors but didn't write the options
  // into the reply text, append them as a numbered list. Observed in a
  // real turn: the coach wrote "Here's a few more — see if any fit:" and
  // stopped, leaving the coachee staring at a colon.
  if (reply.action?.type === "suggest_behaviors") {
    const options = reply.action.options;
    const firstSnippet = options[0]?.slice(0, 20).toLowerCase() ?? "";
    const alreadyIncluded =
      firstSnippet.length > 0 &&
      reply.reply.toLowerCase().includes(firstSnippet);
    if (!alreadyIncluded) {
      const list = options
        .map((o, i) => `${i + 1}. ${o}`)
        .join("\n");
      reply = { ...reply, reply: `${reply.reply.trim()}\n\n${list}` };
    }
  }

  const assistantMessage = await appendMessage(
    map.id,
    "assistant",
    reply.reply,
    map.current_stage,
  );

  if (reply.action) {
    try {
      await applyCoachAction(map.id, map.current_stage, reply.action);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendMessage(
        map.id,
        "system",
        `[action rejected] ${message}`,
        map.current_stage,
      );
    }
  }

  // Backstop that saves the goal only when the coachee affirms the coach's
  // proposal. Fires on the "yes" turn — extracts the last coach-proposed
  // goal from the prior assistant message and writes it. If we ran this
  // unconditionally, the coach's proposal turn (which contains the stem)
  // would save the goal before the coachee confirmed anything.
  const currentGoal = await refreshImprovementGoal(map.id);
  const affirmative = looksAffirmative(parsed.data.text);
  if (map.current_stage === "goal" && !currentGoal && affirmative) {
    // Prefer the prior assistant message (the coach's proposal) — this
    // turn's reply is typically "Locked. Now column 2…" after the "yes".
    const extracted =
      (priorAssistantContent
        ? extractGoalSentence(priorAssistantContent)
        : null) ?? extractGoalSentence(reply.reply);
    console.warn(
      "[itc] goal backstop: affirmative=yes extracted-len=%d action=%s",
      extracted?.length ?? 0,
      reply.action?.type ?? "null",
    );
    if (extracted) {
      try {
        await saveImprovementGoal(map.id, extracted);
        console.warn("[itc] goal backstop: saved goal via extractor");
      } catch (err) {
        console.warn(
          "[itc] goal backstop: saveImprovementGoal threw: %s",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // Safety net: if the coachee affirmed a proposed goal and the coach
  // forgot to emit advance_stage, advance for them. Re-read the goal in
  // case the extractor above just saved it in this same turn.
  const goalNow = await refreshImprovementGoal(map.id);
  if (
    map.current_stage === "goal" &&
    goalNow &&
    reply.action?.type !== "advance_stage" &&
    affirmative
  ) {
    try {
      await advanceStage(map.id, "goal", "behaviors");
    } catch {
      // ignore — already advanced or race
    }
  }

  // Behaviors backstop: coach says "That's a second one, two on the map"
  // but forgets to emit propose_behavior — the reply text and the actual
  // behavior list drift apart, and the coachee sees two bubbles in chat
  // but only one card on the map. Recovery: if we're in the behaviors
  // stage, the user's just-sent message is behavior-shaped, the coach's
  // reply acknowledges it as a new behavior (via count-claim or "that's
  // a Nth one" pattern), and the action this turn wasn't
  // propose_behavior/replace_behavior — insert the user's message as a
  // new behavior. Bounded by the same 5-cap the propose_behavior handler
  // enforces (never insert past 5).
  if (
    map.current_stage === "behaviors" &&
    reply.action?.type !== "propose_behavior" &&
    reply.action?.type !== "replace_behavior" &&
    looksLikeBehaviorCandidate(parsed.data.text) &&
    coachAcknowledgedNewBehavior(reply.reply)
  ) {
    const behaviorsBefore = await listBehaviors(map.id);
    const selectedCount = behaviorsBefore.filter((b) => b.selected).length;
    if (selectedCount < 5) {
      // Only insert if the coach's claimed count is actually greater
      // than reality — this prevents double-inserting if the coach DID
      // fire propose_behavior and is just recapping. The extractor
      // looks for "N on the map", "Now N", "That's N so far" claims.
      const claimedCount = extractCoachBehaviorCount(reply.reply);
      if (claimedCount !== null && claimedCount > selectedCount) {
        try {
          await addBehavior(map.id, parsed.data.text.trim(), "user");
          console.warn(
            "[itc] behaviors backstop: inserted behavior (coach claimed %d on map, actual was %d)",
            claimedCount,
            selectedCount,
          );
        } catch (err) {
          console.warn(
            "[itc] behaviors backstop: addBehavior failed: %s",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }

  // Worries backstop: coach probes to depth, gets a fear-shaped answer,
  // acknowledges it, but forgets to emit propose_worry. The next probe
  // fires against a behavior that doesn't have its worry paired yet, so
  // the pairing shifts by one and the whole map degrades. Recovery: if
  // we're in worries stage, the action this turn wasn't propose_worry,
  // and the coach's reply contains a quoted "I worry that if X ..."
  // sentence, extract it, run the depth rubric, and pair it with the
  // first unpaired selected behavior in order. Same rubric-gate rule as
  // the assumptions backstop: don't force in a proposal that would have
  // been rejected on the normal path.
  if (
    map.current_stage === "worries" &&
    reply.action?.type !== "propose_worry"
  ) {
    const [behaviorsForWorry, worriesForBackstop] = await Promise.all([
      listBehaviors(map.id),
      listWorries(map.id),
    ]);
    const pairedIds = new Set(
      worriesForBackstop
        .filter((w) => w.depth_score !== null)
        .map((w) => w.behavior_id),
    );
    const firstUnpaired = behaviorsForWorry.find(
      (b) => b.selected && !pairedIds.has(b.id),
    );
    if (firstUnpaired) {
      // Extraction priority: user's current message first (coachees
      // often write the worry themselves in "I worry that if X, then
      // Y" form, and if the coach forgot to fire propose_worry on
      // that turn, this is where the real content lives). Fall back
      // to the coach's reply and prior assistant message.
      const extracted =
        extractWorryDraft(parsed.data.text) ??
        extractWorryDraft(reply.reply) ??
        (priorAssistantContent
          ? extractWorryDraft(priorAssistantContent)
          : null);
      if (extracted) {
        try {
          const stemmed = ensureStem(extracted, WORRY_STEM);
          const rubric = await scoreWorryDepth({
            goalText: map.improvement_goal ?? "",
            behaviorText: firstUnpaired.text,
            worryText: stemmed,
          });
          if (rubric.score >= 2) {
            await upsertWorry(map.id, firstUnpaired.id, stemmed, rubric.score);
            await logWorryAttempt({
              mapId: map.id,
              behaviorId: firstUnpaired.id,
              text: stemmed,
              depthScore: rubric.score,
              accepted: true,
              rejectReason: null,
            });
            console.warn(
              "[itc] worries backstop: paired extracted worry to behavior %s (score %d/3)",
              firstUnpaired.id,
              rubric.score,
            );
          } else {
            console.warn(
              "[itc] worries backstop: rubric would reject draft (score %d/3) — not persisting",
              rubric.score,
            );
          }
        } catch (err) {
          console.warn(
            "[itc] worries backstop: upsertWorry failed: %s",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }

  // Auto-advance worries → commitments the moment every selected behavior
  // has a locked worry. Runs regardless of what action fired this turn:
  // the coach only has one action slot and may have spent it on a
  // draft-related pseudo-action or nothing, so gating on
  // reply.action?.type === "propose_worry" missed the case where the
  // last worry landed on an earlier turn and the coach then drafted
  // commitments without ever emitting advance_stage. Idempotent — no-ops
  // if already advanced.
  if (map.current_stage === "worries") {
    const [behaviorsNow, worriesNow] = await Promise.all([
      listBehaviors(map.id),
      listWorries(map.id),
    ]);
    const selectedIds = new Set(
      behaviorsNow.filter((b) => b.selected).map((b) => b.id),
    );
    const lockedBehaviorIds = new Set(
      worriesNow
        .filter((w) => w.depth_score !== null && selectedIds.has(w.behavior_id))
        .map((w) => w.behavior_id),
    );
    const allLocked =
      selectedIds.size > 0 && lockedBehaviorIds.size === selectedIds.size;
    if (allLocked) {
      try {
        await advanceStage(map.id, "worries", "commitments");
      } catch {
        // ignore — race or already advanced
      }
    }
  }

  // Commitments backstop: if the coachee just affirmed the drafted list
  // and the coach forgot to emit propose_commitments_batch (observed:
  // "Locking these in." reply with action=null, repeated for many turns
  // as the drafts scrolled further back in history), scan backwards
  // through prior assistant messages and use the most recent one that
  // has a matching draft count. Only fires when no commitments are
  // locked yet AND we find drafts matching the locked-worry count, so
  // partial states can't get scrambled. Same pattern as the goal
  // backstop above.
  if (looksLikeCommitmentAffirmation(parsed.data.text, reply.reply)) {
    // Guard removed: was skipping the backstop when the coach EMITTED
    // propose_commitments_batch, but that action can fail silently
    // (rubric rejects, garbled text, etc.) and leave the map without
    // commitments even though the coach thinks it succeeded. The inner
    // `commitmentsNow.length === 0` check prevents double-inserts on
    // the success path, so removing the outer guard is safe.
    const [worriesForBackstop, commitmentsNow, mapForBackstop] =
      await Promise.all([
        listWorries(map.id),
        listCommitments(map.id),
        getMapById(map.id),
      ]);
    const lockedWorries = worriesForBackstop.filter(
      (w) => w.depth_score !== null,
    );
    const stageOk =
      mapForBackstop?.current_stage === "commitments" ||
      mapForBackstop?.current_stage === "worries";

    // Scan priorHistory backwards for the first assistant message whose
    // draft count matches the locked-worry count. Only look at
    // assistant messages — user messages never contain drafts.
    let draftsFromHistory: string[] = [];
    if (
      stageOk &&
      commitmentsNow.length === 0 &&
      lockedWorries.length > 0
    ) {
      for (let i = priorHistory.length - 1; i >= 0; i--) {
        const msg = priorHistory[i];
        if (msg.role !== "assistant") continue;
        const candidate = extractCommitmentDrafts(msg.content);
        if (candidate.length === lockedWorries.length) {
          draftsFromHistory = candidate;
          break;
        }
      }
    }

    if (
      stageOk &&
      commitmentsNow.length === 0 &&
      lockedWorries.length > 0 &&
      draftsFromHistory.length === lockedWorries.length
    ) {
      if (mapForBackstop?.current_stage === "worries") {
        try {
          await advanceStage(map.id, "worries", "commitments");
        } catch {
          // ignore — race or advance guard already fired
        }
      }
      for (let i = 0; i < lockedWorries.length; i++) {
        try {
          await addCommitment(
            map.id,
            lockedWorries[i].id,
            ensureStem(draftsFromHistory[i], COMMITMENT_STEM),
          );
        } catch (err) {
          console.warn(
            "[itc] commitments backstop: addCommitment failed: %s",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      console.warn(
        "[itc] commitments backstop: inserted %d drafts from history scan",
        draftsFromHistory.length,
      );
    }
  }

  // Test-design backstop: if the coachee affirms "save it" style and the
  // coach didn't fire save_test_design, extract the drafted test from a
  // prior assistant message and persist it ourselves. Only fires when no
  // test row exists yet on this map so multi-test iterations aren't
  // disturbed. All-or-nothing extraction — if any field is missing, skip.
  if (
    reply.action?.type !== "save_test_design" &&
    looksAffirmative(parsed.data.text)
  ) {
    const mapForTest = await getMapById(map.id);
    if (
      mapForTest?.current_stage === "test_design" ||
      mapForTest?.current_stage === "prioritize"
    ) {
      const existingTests = await listTests(map.id);
      const selectedAssumption = (
        await listAssumptions(map.id)
      ).find((a) => a.selected_for_testing);
      if (existingTests.length === 0 && selectedAssumption) {
        for (let i = priorHistory.length - 1; i >= 0; i--) {
          const msg = priorHistory[i];
          if (msg.role !== "assistant") continue;
          const draft = extractTestDraft(msg.content);
          if (!draft) continue;
          try {
            // Advance to test_design first if we're still in prioritize
            // (backstop is tolerant of the coach skipping the explicit
            // advance action).
            if (mapForTest.current_stage === "prioritize") {
              try {
                await advanceStage(map.id, "prioritize", "test_design");
              } catch {
                // ignore
              }
            }
            await saveTestDraft({
              mapId: map.id,
              assumptionId: selectedAssumption.id,
              testType: draft.test_type,
              assumptionSays: draft.assumption_says,
              behaviorChange: draft.behavior_change,
              dataToCollect: draft.data_to_collect,
              inOrderToFindOut: draft.in_order_to_find_out,
              targetDate: draft.target_date,
            });
            try {
              await advanceStage(map.id, "test_design", "test_running");
            } catch {
              // ignore
            }
            console.warn(
              "[itc] test-design backstop: saved test from history scan",
            );
          } catch (err) {
            console.warn(
              "[itc] test-design backstop: saveTestDraft failed: %s",
              err instanceof Error ? err.message : String(err),
            );
          }
          break;
        }
      }
    }
  }

  // Assumptions backstop: same failure mode as commitments. Coach walks
  // the coverage check, coachee affirms ("that makes sense", "yes",
  // etc.), coach's reply says "Locking that in..." but the actual
  // propose_assumption action never fires. Result: the map stays on the
  // commitments/assumptions stage forever with an empty Big Assumptions
  // column, and downstream stages (review, immune_system) can't unlock.
  //
  // Recovery: if we're in assumptions with zero assumptions on the map,
  // scan history for a quoted "I assume that ..." from a prior assistant
  // message. Persist it linked to ALL commitments (the coverage
  // walk-through defends coverage of all four; a coach who skipped the
  // action but wrote the reveal text was working with the same premise).
  if (looksAffirmative(parsed.data.text)) {
    // Guard removed: was skipping the backstop when the coach EMITTED
    // propose_assumption, but that action can fail silently (rubric
    // rejects, no valid commitment_indices, etc.) — the assumption
    // never lands on the map even though the coach thinks it did.
    // The inner `assumptionsNow.length === 0` check prevents
    // double-inserts on the success path.
    const mapForAssumption = await getMapById(map.id);
    if (mapForAssumption?.current_stage === "assumptions") {
      const [assumptionsNow, commitmentsForLink] = await Promise.all([
        listAssumptions(map.id),
        listCommitments(map.id),
      ]);
      if (assumptionsNow.length === 0 && commitmentsForLink.length > 0) {
        let draftText: string | null = null;
        for (let i = priorHistory.length - 1; i >= 0; i--) {
          const msg = priorHistory[i];
          if (msg.role !== "assistant") continue;
          const extracted = extractAssumptionDraft(msg.content);
          if (extracted) {
            draftText = extracted;
            break;
          }
        }
        if (draftText) {
          try {
            const stemmed = ensureStem(draftText, ASSUMPTION_STEM);
            const rubric = await scoreAssumptionDepth({
              goalText: mapForAssumption.improvement_goal ?? "",
              assumptionText: stemmed,
            });
            // Only land if the rubric would have passed. If it wouldn't
            // have, the coach was probably going to be rejected anyway
            // and forcing it in via the backstop hides a real problem.
            if (rubric.score >= 2) {
              const assumption = await addAssumption(
                map.id,
                stemmed,
                rubric.score,
              );
              await linkAssumptionToCommitments(
                assumption.id,
                commitmentsForLink.map((c) => c.id),
              );
              console.warn(
                "[itc] assumptions backstop: inserted assumption from history scan (linked to %d commitments)",
                commitmentsForLink.length,
              );
            } else {
              console.warn(
                "[itc] assumptions backstop: rubric would reject draft (score %d/3) — not persisting",
                rubric.score,
              );
            }
          } catch (err) {
            console.warn(
              "[itc] assumptions backstop: addAssumption failed: %s",
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }
    }
  }

  const cascadeStart = Date.now();
  // Cascade auto-advance across every stage transition where the coach
  // has proven capable of forgetting the action. On any affirmation,
  // re-read the map after each advance and try the next transition if
  // its conditions are met. Runs until no transition applies. Bounded
  // so a logic bug can't spin forever.
  //
  // Covers, in order:
  //   behaviors    → worries          (needs 3-5 selected)
  //   commitments  → assumptions      (auto-marks reveal_delivered first)
  //   assumptions  → review           (needs full commitment coverage)
  //   review       → immune_system
  //   immune_system→ prioritize       (auto-marks walkthrough_delivered)
  //   prioritize   → test_design      (needs a selected_for_testing pick)
  //
  // Aggressive on purpose: by the time the coachee is affirming in any
  // of these stages, the substantive work is done or done-enough. Being
  // stuck is worse than advancing.
  if (looksAffirmative(parsed.data.text)) {
    for (let step = 0; step < 8; step++) {
      const currentMap = await getMapById(map.id);
      if (!currentMap) break;
      const from = currentMap.current_stage;
      let advanced = false;

      if (from === "behaviors") {
        const behaviorsNow = await listBehaviors(map.id);
        const selectedCount = behaviorsNow.filter((b) => b.selected).length;
        if (selectedCount >= 1 && selectedCount <= 5) {
          try {
            await advanceStage(map.id, "behaviors", "worries");
            advanced = true;
          } catch {
            // ignore — race or advance guard rejected
          }
        }
      } else if (from === "commitments") {
        // Advance to assumptions the moment every locked worry has a
        // commitment. The old flow required reveal_delivered=true here
        // because the coach used to deliver a mini gas-and-brake
        // reveal at commitments; that's been removed (the full
        // walkthrough lands at immune_system after review) so the
        // reveal flag no longer gates this transition.
        //
        // Additional guard: if the current turn's action IS the batch
        // itself, do NOT advance on this turn — leave the coachee a
        // beat with the freshly-locked list before the stage flips.
        if (reply.action?.type === "propose_commitments_batch") {
          break;
        }
        const [worriesNow, commitmentsNow] = await Promise.all([
          listWorries(map.id),
          listCommitments(map.id),
        ]);
        const lockedWorries = worriesNow.filter((w) => w.depth_score !== null);
        const covered = new Set(commitmentsNow.map((c) => c.worry_id));
        const uncoveredWorries = lockedWorries.filter((w) => !covered.has(w.id));
        if (lockedWorries.length > 0 && uncoveredWorries.length === 0) {
          try {
            await advanceStage(map.id, "commitments", "assumptions");
            advanced = true;
          } catch {
            // ignore
          }
        }
      } else if (from === "assumptions") {
        // Only advance to review when every commitment is covered by
        // at least one assumption. This matches the advanceStage
        // gate; without the coverage check, advanceStage would throw
        // and we'd loop uselessly.
        const [commitmentsNow, links] = await Promise.all([
          listCommitments(map.id),
          listAssumptionLinks(map.id),
        ]);
        const covered = new Set(links.map((l) => l.commitment_id));
        const uncovered = commitmentsNow.filter((c) => !covered.has(c.id));
        if (uncovered.length === 0 && commitmentsNow.length > 0) {
          try {
            await advanceStage(map.id, "assumptions", "review");
            advanced = true;
          } catch {
            // ignore — race or advance guard rejected
          }
        }
      } else if (from === "review") {
        // review → immune_system has no reveal_delivered gate anymore
        // (the mini reveal at commitments was removed; the full
        // walkthrough happens at immune_system). Advance on any
        // affirmation once the map holds a complete picture.
        try {
          await advanceStage(map.id, "review", "immune_system");
          advanced = true;
        } catch (err) {
          console.warn(
            "[itc cascade] review → immune_system advance failed: %s",
            err instanceof Error ? err.message : String(err),
          );
        }
      } else if (from === "immune_system") {
        if (!currentMap.walkthrough_delivered) {
          try {
            await markWalkthroughDelivered(map.id);
          } catch (err) {
            console.warn(
              "[itc cascade] immune_system branch: markWalkthroughDelivered failed: %s",
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        try {
          await advanceStage(map.id, "immune_system", "prioritize");
          advanced = true;
        } catch (err) {
          console.warn(
            "[itc cascade] immune_system → prioritize advance failed: %s",
            err instanceof Error ? err.message : String(err),
          );
        }
      } else if (from === "prioritize") {
        // Advance to test_design only if a pick is on record. If the
        // coach recommended one and the coachee affirmed without an
        // explicit select, auto-adopt the recommendation as the
        // selection — his "yes" reasonably endorses the coach's pick.
        //
        // Bug fix: previously fell back to assumptions[0] when neither
        // selected nor recommended. That silently picked the wrong
        // assumption when coachee came back to prioritize from results
        // to test a DIFFERENT one — clearSelectedAssumption clears
        // BOTH selection and recommendation, so the fallback picked
        // the original assumption and the coachee's intent got lost.
        // Now: no recommendation, no auto-advance. Cascade stalls at
        // prioritize until coach fires select_assumption_for_testing.
        const assumptionsNow = await listAssumptions(map.id);
        const alreadySelected = assumptionsNow.find(
          (a) => a.selected_for_testing,
        );
        if (!alreadySelected) {
          const recommended = assumptionsNow.find(
            (a) => a.coach_recommended,
          );
          if (recommended) {
            try {
              await setAssumptionSelected(recommended.id, map.id);
            } catch {
              // ignore
            }
          } else if (assumptionsNow.length === 1) {
            // Single-assumption case (common when the coverage
            // walk-through consolidated to one) — no ambiguity, pick
            // it. Skips the coach having to fire
            // select_assumption_for_testing for the trivial case.
            try {
              await setAssumptionSelected(assumptionsNow[0].id, map.id);
            } catch {
              // ignore
            }
          } else {
            // Multiple assumptions with no recommendation and no pick
            // — don't fabricate one; cascade stalls at prioritize
            // until the coach fires select_assumption_for_testing.
            break;
          }
        }
        try {
          await advanceStage(map.id, "prioritize", "test_design");
          advanced = true;
        } catch {
          // ignore
        }
      } else if (from === "results") {
        // Only advance to done on EXPLICIT close signals. A generic "yes"
        // in the results stage might just be acknowledging a coach
        // question, not asking to close the map. Requires looksLikeClose
        // (below) which matches "close it out", "we're done", etc.
        if (looksLikeMapClose(parsed.data.text)) {
          // Advance first — if the transition fails (illegal jump,
          // etc.) we don't want markMapComplete to leave the map in
          // an inconsistent state.
          try {
            await advanceStage(map.id, "results", "done");
            advanced = true;
            try {
              await markMapComplete(map.id);
            } catch {
              // ignore — non-fatal
            }
          } catch {
            // ignore — race or advance guard rejected
          }
        }
      }

      if (!advanced) {
        // Log where cascade stopped and why. Helps debug the "coach
        // stuck at stage X even after N affirmations" family of bugs
        // that only show up in E2E runs.
        console.warn(
          "[itc cascade] stopped at stage=%s after step=%d (advance conditions not met — check reveal/walkthrough flags, coverage counts, and stage-specific gates)",
          from,
          step,
        );
        break;
      }
    }
  }

  const cascadeMs = Date.now() - cascadeStart;

  // If the stage changed during this turn (via coach action or one of the
  // safety nets), retag the assistant message with the new stage so the
  // transition reply ("Locked. Now column 2…") lives in the new stage's
  // chat pane rather than the one we just left.
  const finalMap = await getMapById(map.id);
  if (finalMap && finalMap.current_stage !== map.current_stage) {
    try {
      await retagMessageStage(assistantMessage.id, finalMap.current_stage);
    } catch {
      // non-fatal
    }
  }

  // Turn-summary timing log — one line per turn so you can grep the
  // dev terminal or Vercel logs for "[itc timing] turn" and see where
  // time is going. Breakdown: llm = generateObject + any retries +
  // fallback. cascade = auto-advance loop (multiple DB reads and
  // potential advanceStage calls, no LLM). total = end-to-end wall
  // clock including all pre-LLM DB fetches, action apply, backstops
  // (which may include rubric LLM calls), and post-turn writes.
  const stageChanged = finalMap && finalMap.current_stage !== map.current_stage;
  console.warn(
    "[itc timing] turn map=%s stage=%s%s action=%s llm=%dms cascade=%dms total=%dms",
    map.id,
    map.current_stage,
    stageChanged ? `->${finalMap.current_stage}` : "",
    reply.action?.type ?? "none",
    llmMs,
    cascadeMs,
    Date.now() - turnStart,
  );

  // revalidatePath ties into Next's request-scoped static-generation
  // store; when called outside a real request (E2E tests calling this
  // function directly) it throws "static generation store missing".
  // Cache invalidation is fire-and-forget from our perspective, so a
  // failure here shouldn't fail the whole turn.
  try {
    revalidatePath(`/itc/${map.id}`);
  } catch {
    // no-op — outside a request context, no cache to invalidate
  }
  return { ok: true };
}

async function refreshImprovementGoal(mapId: string): Promise<string | null> {
  const m = await getMapById(mapId);
  return m?.improvement_goal ?? null;
}

// Pull the first "I'm committed to getting better at ..." sentence out of a
// coach reply so we can save the goal even when the model skips propose_goal.
// Two subtleties observed in the wild:
// 1. Models often output smart quotes/apostrophes even when the prompt uses
//    straight ASCII. Normalizing both sides before indexOf so U+2019 in the
//    coach's "I'm" doesn't miss the stem match.
// 2. The captured sentence ends at the first period followed by a quote,
//    whitespace, or end-of-string — this dodges the apostrophe inside "I'm".
function extractGoalSentence(text: string): string | null {
  // Match the whole stem+tail directly with a case-insensitive regex that
  // tolerates a smart-apostrophe or missing apostrophe in "I'm". Reconstruct
  // the sentence with canonical ASCII punctuation regardless of what the
  // coach emitted. This is more resilient than an indexOf + slice pipeline
  // which broke silently in the field.
  const re = /I[\u2019'\u02BC]?m committed to getting better at ([^\n.]+)\./i;
  const match = text.match(re);
  if (match) {
    const tail = match[1].trim();
    if (tail.length > 0) return `I'm committed to getting better at ${tail}.`;
  }

  // No period-terminated sentence — take everything up to first newline or
  // closing quote as a fallback.
  const looseRe = /I[\u2019'\u02BC]?m committed to getting better at ([^\n"\u201D]+)/i;
  const loose = text.match(looseRe);
  if (!loose) return null;
  const tail = loose[1]
    .trim()
    .replace(/[,;:—–]\s+.*$/, "") // drop trailing clauses like ", right?"
    .replace(/[!?.]+$/, "")
    .trim();
  return tail.length > 0 ? `I'm committed to getting better at ${tail}.` : null;
}

// Guard around the coach call: filters out empty replies, consecutive
// duplicates, and JSON-fragment garbage (all seen in real sessions —
// `.}` was the most recent). On any hit we give the coach ONE regen
// with a nudge that explains the specific failure mode.
async function runItcCoachTurnWithGuards(
  input: Parameters<typeof runItcCoachTurn>[0] & { priorAssistantContent: string | null },
) {
  const { priorAssistantContent, ...coachInput } = input;
  const first = await runItcCoachTurn(coachInput);
  const trimmed = first.reply.trim();
  const isEmpty = trimmed.length === 0;
  const isDupe =
    priorAssistantContent !== null &&
    trimmed === priorAssistantContent.trim();
  // Three garbage shapes to catch:
  // (a) zero letters (`.}` etc.)
  // (b) JSON-fragment leakage where the reply has letters but is polluted
  //     with schema keys / bracket bleed / model self-disclaimers
  // (c) bare status — no question, no call-to-action anywhere. Preamble
  //     rule "every reply ends with a question or instruction" is
  //     violated frequently by the model even when spelled out. Enforce
  //     at guard layer with a retry.
  const isNoLetters = !isEmpty && !/[A-Za-z]/.test(trimmed);
  const isJsonLeakage = !isEmpty && looksLikeStructuredOutputLeakage(trimmed);
  const isGarbage = isNoLetters || isJsonLeakage;
  const isBareStatus =
    !isEmpty &&
    !isDupe &&
    !isGarbage &&
    looksLikeBareStatus(trimmed, first.action?.type ?? null);
  if (!isEmpty && !isDupe && !isGarbage && !isBareStatus) return first;

  if (isGarbage) {
    console.warn(
      "[itc] coach reply looked like garbage (%s), regenerating. raw=%o",
      isJsonLeakage ? "json-leakage" : "no-letters",
      first.reply,
    );
  }
  if (isBareStatus) {
    console.warn(
      "[itc] coach reply had no question or call-to-action, regenerating. raw=%o",
      first.reply,
    );
  }

  const nudge = isEmpty
    ? "Your previous attempt returned empty. Produce a real reply this time."
    : isGarbage
      ? "Your previous attempt included JSON-fragment artifacts or non-prose characters in the reply text. Write plain prose the coachee can read — no schema keys, no bracket sequences, no meta-commentary about formatting."
      : isBareStatus
        ? "Your previous attempt ended on a bare status ('Locked.', 'That covers #3 and #4.', 'Locking it in.') with no question or instruction. Every reply must end with something the coachee can respond to — a question ('does that hold?', 'ready for the next cluster?') or an actionable instruction ('read each and tell me which don't fit', 'save it when ready'). Rewrite ending with a specific ask tied to what just happened."
        : "Your previous attempt duplicated the last assistant message verbatim. Say something different that moves the work forward.";
  const regenerated = await runItcCoachTurn({
    ...coachInput,
    history: [
      ...coachInput.history,
      { role: "assistant", content: first.reply || "(empty)" },
      { role: "user", content: `[system nudge] ${nudge}` },
    ],
  });
  // If the regen still fails, take it anyway — the plain-text fallback
  // inside runItcCoachTurn guarantees a non-empty reply.
  return regenerated;
}

/**
 * True when the reply looks like a bare status update with no question
 * and no clear call-to-action. Backstop for the preamble rule "every
 * reply ends with a question or instruction" — the model violates this
 * often even when the rule is spelled out, so we retry at the guard
 * layer.
 *
 * The check is a simple two-signal test on the LAST 300 characters:
 *   - Contains a `?` (any question), OR
 *   - Contains a recognizable call-to-action phrase
 * If neither is present, the reply is a bare status. Retry.
 *
 * The heuristic must be tolerant of legitimate reply shapes:
 *   - Numbered lists (suggest_behaviors) — usually end without `?` but
 *     the closing line typically has a CTA ("pick one", "which fits").
 *     If the prompt is updated to require one, this check enforces it.
 *   - Done-stage close — invitation-to-return line counts as CTA
 *     ("your map stays here… anytime you want").
 *
 * Skip the check for very short replies (<40 chars) — a brief
 * acknowledgment before an action-only turn is legitimate and rare.
 */
function looksLikeBareStatus(
  reply: string,
  actionType: string | null,
): boolean {
  if (reply.length < 40) return false;
  // A reply that carries certain actions is naturally short-and-status
  // (e.g. mark_reveal_delivered acknowledges an already-delivered
  // reveal). Don't force a CTA on those.
  if (
    actionType === "mark_reveal_delivered" ||
    actionType === "mark_walkthrough_delivered"
  ) {
    return false;
  }
  const tail = reply.slice(-350);
  // Any question mark in the tail counts as a question.
  if (tail.includes("?")) return false;
  // Call-to-action phrases that legitimately close a reply without a
  // question mark. Lowercased match. Keep this list conservative —
  // false positives just cost a retry (~1-3s), false negatives ship
  // the bug the user has been catching.
  const ctaPhrases = [
    "tell me",
    "let me know",
    "ready to",
    "ready when",
    "want to",
    "want me to",
    "want a",
    "pick one",
    "choose one",
    "choose which",
    "which one",
    "which of",
    "read each",
    "read it",
    "read them",
    "read the",
    "come back",
    "save it",
    "type ",
    "type in",
    "answer with",
    "wait for",
    "when you're ready",
    "when it's ready",
    "when the set",
    "next time",
    "your call",
    "your move",
    "say the word",
    "say 'lock",
    "reword any",
    "give me",
    "walk me through",
    "take a minute",
    "take a swing",
    "sit with",
    "notice when",
    "look back",
    "come here",
    "come find",
    "map stays here",
    "anytime you want",
    "we're done for today",
  ];
  const lowerTail = tail.toLowerCase();
  return !ctaPhrases.some((p) => lowerTail.includes(p));
}


// Affirmation detector tuned for the commitments-batch backstop. Wider
// than looksAffirmative (which is for the tight goal-lock path) because
// coachees say things like "these are great" here. Also fires if the
// coach's own reply signals a lock ("locked", "locking these in") since
// that's the exact failure mode we're recovering from.
function looksLikeCommitmentAffirmation(
  userMessage: string,
  coachReply: string,
): boolean {
  const t = userMessage.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (t.length === 0 || t.length > 200) return false;

  const userAffirms = [
    "these are great", "these are good", "these are perfect",
    "these are it", "these work", "these fit", "these look right",
    "these look good", "these are right", "go with these",
    "nailed it", "spot on", "perfect", "sounds right",
    "lock them in", "lock these in", "lock it in", "lock em in",
    "lock in", "locked", "locking in",
    "yes lock them in", "yes lock", "yes please",
    // Same "that makes sense" family as looksAffirmative — coachees
    // affirm the drafted commitment set this way just as often as
    // "lock them in", and the batch backstop needs to catch both.
    "that makes sense", "makes sense", "yeah that makes sense",
    "yes that makes sense", "yeah makes sense", "yes makes sense",
    "that tracks", "tracks", "that's right", "thats right",
    "you got it", "you nailed it", "exactly", "correct",
  ];
  if (userAffirms.some((p) => t === p || t.startsWith(`${p} `))) return true;

  // Fallback: coach's own reply announced the lock. If we're recovering
  // from a missing batch action, the coach is likely saying "Locked" /
  // "Locking these in" as the reply text.
  if (/\b(locking|locked|lock in|locking these in|locking them in)\b/i.test(coachReply)) {
    // Only count coach-signal if the user said something short and
    // non-negative — filters out "no wait, change #2".
    const looksNegative = /\b(no|wait|hold on|change|swap|tweak|reword|not quite|not right)\b/i.test(userMessage);
    if (!looksNegative) return true;
  }

  return false;
}

// Pulls a quoted "I assume that if X, then Y" out of an assistant
// message so the assumptions backstop can persist it when the coach
// wrote the reveal text ("Locking that in: '...'") but never fired
// propose_assumption. Only extracts if we can find a QUOTED assumption
// — a bare "I assume that" fragment inside general prose is too easy
// to false-positive on. Returns the extracted text WITHOUT the stem
// (caller re-applies via ensureStem).
// Pulls a drafted test out of a prior assistant message so the server
// can fire save_test_design when the coach forgot to. Requires all four
// field labels + a target_date + a recognizable test_type — otherwise
// the extraction is not confident enough to persist. Same defensive
// pattern as extractCommitmentDrafts and the goal extractor.
type ExtractedTestDraft = {
  test_type: "data_mining" | "observation" | "thought_experiment" | "behavioral";
  assumption_says: string;
  behavior_change: string;
  data_to_collect: string;
  in_order_to_find_out: string;
  target_date: string;
};

function extractTestDraft(text: string): ExtractedTestDraft | null {
  const fieldRe = (label: string) =>
    new RegExp(
      `${label}\\s*[:\\-–]\\s*(.+?)(?=\\n\\s*(?:assumption[_ ]says|test[_ ]move|behavior[_ ]change|data[_ ]to[_ ]collect|in[_ ]order[_ ]to[_ ]find[_ ]out|target[_ ]date)\\s*[:\\-–]|\\n\\n|$)`,
      "is",
    );
  const assumptionSays = text.match(fieldRe("assumption[_ ]says"))?.[1]?.trim();
  const testMove = text.match(fieldRe("(?:test[_ ]move|behavior[_ ]change)"))?.[1]?.trim();
  const dataToCollect = text.match(fieldRe("data[_ ]to[_ ]collect"))?.[1]?.trim();
  const inOrderTo = text.match(fieldRe("in[_ ]order[_ ]to[_ ]find[_ ]out"))?.[1]?.trim();
  const dateMatch = text.match(/target[_ ]date\s*[:\-–]\s*(\d{4}-\d{2}-\d{2})/i);
  const targetDate = dateMatch?.[1];

  if (!assumptionSays || !testMove || !dataToCollect || !inOrderTo || !targetDate) {
    return null;
  }

  // Test type from the header. Match on the labels the coach uses in prose.
  let testType: ExtractedTestDraft["test_type"] | null = null;
  if (/data[- ]mining|data_mining/i.test(text)) testType = "data_mining";
  else if (/self[- ]observation|self_observation|\bobservation\b/i.test(text))
    testType = "observation";
  else if (/thought[- ]experiment|thought_experiment/i.test(text))
    testType = "thought_experiment";
  else if (/\bbehavioral\b/i.test(text)) testType = "behavioral";

  if (!testType) return null;

  return {
    test_type: testType,
    assumption_says: assumptionSays,
    behavior_change: testMove,
    data_to_collect: dataToCollect,
    in_order_to_find_out: inOrderTo,
    target_date: targetDate,
  };
}

// Recognizes an explicit "close the map for now" from the coachee at
// results stage. Stricter than looksAffirmative because a generic "yes"
// at results might just be acknowledging a coach probe; we only advance
// to `done` on unambiguous close signals.
function looksLikeMapClose(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (t.length === 0 || t.length > 120) return false;
  const closes = [
    "close it out",
    "close it",
    "close the map",
    "close for now",
    "we're done",
    "we are done",
    "done for now",
    "i'm done",
    "im done",
    "that's it for today",
    "thats it for today",
    "that's a wrap",
    "thats a wrap",
    "wrap it up",
    "map complete",
    "mark it complete",
    "finished",
    "we're good",
    "were good",
    "all set",
  ];
  return closes.some((c) => t === c || t.includes(c));
}

// Very permissive affirmation detector — the only cost of a false positive
// is auto-advancing to behaviors, which the coachee can still walk back.
function looksAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (t.length === 0 || t.length > 80) return false;
  const affirmations = [
    "y", "ya", "ye", "yes", "yeah", "yep", "yup", "yessir",
    "ok", "okay", "kk", "k",
    "sure", "sounds good", "sounds great", "good", "great", "perfect",
    "lock it in", "lock it", "locked", "lock",
    "do it", "let's do it", "lets do it", "let's go", "lets go",
    "agreed", "agree", "confirm", "confirmed",
    "yes please", "yes lock it", "yes lock it in",
    "that works", "works for me", "fine", "sounds right",
    // "that makes sense" family — a very common natural affirmation
    // that was slipping past the cascade until we added it here. When a
    // coachee says "that makes sense" they mean "I accept it, move on."
    "that makes sense", "makes sense", "yeah that makes sense",
    "yes that makes sense", "yeah makes sense", "yes makes sense",
    "that tracks", "tracks", "that's right", "thats right", "right",
    "you got it", "you nailed it", "exactly", "correct",
    "👍", "✅", "yes 👍",
  ];
  if (affirmations.includes(t)) return true;
  // Broader "move forward" patterns for late-stage messages that don't
  // fit the exact-match list. Observed: "Let's design a test", "I'm
  // ready for testing", "ready to test", "let's build the test".
  // These all mean "advance me" but wouldn't match the list above.
  const movePatterns = [
    /^let['\u2019]?s (design|build|do|run|test|move|make|go|create|start|try)\b/,
    /^i['\u2019]?m ready\b/,
    /^ready (to|for)\b/,
    /^let['\u2019]?s (move|go|do it)\b/,
    /^(yeah|yes|ok|sure|good)[\s,]+(let['\u2019]?s|move|go|close|finish|wrap)\b/,
    /^(next|next step|move on|keep going|continue)\b/,
    // Close signals — needed to trip the outer cascade gate so the
    // results → done branch has a chance to run its looksLikeMapClose
    // check.
    /^(yes|yeah|ok|sure)[\s,]+close/,
    /^close (it|the map|out|for now)/,
    /\bwe['\u2019]?re done\b/,
    /\bdone for (today|now)\b/,
  ];
  return movePatterns.some((re) => re.test(t));
}

async function applyCoachAction(
  mapId: string,
  currentStage: ItcStage,
  action: CoachAction,
): Promise<void> {
  switch (action.type) {
    case "propose_goal": {
      // No-op: proposing is not the same as locking. The goal lands in the
      // map only after the coachee affirms — the backstop extractor in
      // sendCoachMessage scans the prior assistant message on the "yes"
      // turn and saves it there. This prevents column 1 from populating
      // before the coachee has confirmed anything.
      console.warn(
        "[itc] propose_goal noted (no DB write yet). stage=%s text=%o",
        currentStage,
        action.text,
      );
      return;
    }
    case "propose_behavior": {
      if (currentStage !== "behaviors") return;
      await addBehavior(mapId, action.text, "suggested");
      return;
    }
    case "suggest_behaviors": {
      // Suggestions are surfaced in the reply text only. The coachee reads
      // them, picks one (or writes his own), and the coach emits
      // propose_behavior on the next turn to land it on the map.
      return;
    }
    case "replace_behavior": {
      if (currentStage !== "behaviors") return;
      const all = await listBehaviors(mapId);
      const target = all[action.index - 1];
      if (!target) {
        throw new Error(
          `replace_behavior: index ${action.index} out of range (${all.length} behaviors).`,
        );
      }
      if (!target.selected) {
        throw new Error(
          `replace_behavior: index ${action.index} points at a legacy-parked behavior — do not consolidate into off-map rows.`,
        );
      }
      await updateBehaviorText(target.id, mapId, action.text);
      return;
    }
    case "remove_behavior": {
      if (currentStage !== "behaviors") {
        throw new Error(
          `remove_behavior: only allowed at behaviors stage (current: ${currentStage}). Removing a behavior after worries pair against it would orphan a locked worry.`,
        );
      }
      const all = await listBehaviors(mapId);
      const target = all[action.index - 1];
      if (!target) {
        throw new Error(
          `remove_behavior: index ${action.index} out of range (${all.length} behaviors).`,
        );
      }
      await deleteBehavior(target.id, mapId);
      return;
    }
    case "propose_worry": {
      if (currentStage !== "worries") return;
      // Reject garbled action text before running the depth rubric.
      // Observed on the map: "I worry that i worworry that ifbringing
      // up her past" — doubled stems + missing-space compounds slipped
      // past the reply-level leakage guard because the corruption was
      // in the ACTION text, not the reply.
      if (looksLikeStructuredOutputLeakage(action.text)) {
        throw new Error(
          `propose_worry: text is garbled (doubled stems or repeated fragments). Re-draft the worry cleanly in your next attempt.`,
        );
      }
      // behavior_index is 1-based into the SELECTED-only list the coach
      // sees, matching the prompt's context block.
      const all = await listBehaviors(mapId);
      const selected = all.filter((b) => b.selected);
      const behavior = selected[action.behavior_index - 1];
      if (!behavior) {
        throw new Error(
          `propose_worry: behavior_index ${action.behavior_index} out of range (${selected.length} selected).`,
        );
      }
      const stemmedText = ensureStem(action.text, WORRY_STEM);
      const map = await getMapById(mapId);
      const rubric = await scoreWorryDepth({
        goalText: map?.improvement_goal ?? "",
        behaviorText: behavior.text,
        worryText: stemmedText,
      });
      const priorAttempts = await countWorryAttempts(behavior.id);
      const passed =
        rubric.score === 3 || (rubric.score === 2 && priorAttempts >= 1);

      await logWorryAttempt({
        mapId,
        behaviorId: behavior.id,
        text: stemmedText,
        depthScore: rubric.score,
        accepted: passed,
        rejectReason: passed ? null : rubric.reason,
      });

      if (!passed) {
        // Rejection lands as an [action rejected] system message via the
        // catch in sendCoachMessage. Include the rubric's reason so the
        // coach's next turn can excavate rather than repeat the same worry.
        throw new Error(
          `worry not deep enough (score ${rubric.score}/3): ${rubric.reason}. Keep excavating with the coachee — do NOT re-propose the same text.`,
        );
      }

      await upsertWorry(mapId, behavior.id, stemmedText, rubric.score);
      return;
    }
    case "propose_commitment": {
      if (currentStage !== "commitments") return;
      if (looksLikeStructuredOutputLeakage(action.text)) {
        throw new Error(
          `propose_commitment: text is garbled (doubled stems or repeated fragments). Re-draft cleanly.`,
        );
      }
      const worries = await listWorries(mapId);
      const locked = worries.filter((w) => w.depth_score !== null);
      const worry = locked[action.worry_index - 1];
      if (!worry) {
        throw new Error(
          `propose_commitment: worry_index ${action.worry_index} out of range (${locked.length} locked).`,
        );
      }
      const stemmedText = ensureStem(action.text, COMMITMENT_STEM);
      const map = await getMapById(mapId);
      const rubric = await scoreCommitmentDepth({
        goalText: map?.improvement_goal ?? "",
        worryText: worry.text,
        commitmentText: stemmedText,
      });
      if (!rubric.passes) {
        throw new Error(
          `commitment reads as productivity advice, not self-protection: ${rubric.reason}. Rework it — the protective flinch has to be visible.`,
        );
      }
      await addCommitment(mapId, worry.id, stemmedText);
      return;
    }
    case "propose_commitments_batch": {
      if (currentStage !== "commitments") return;
      const worries = await listWorries(mapId);
      const locked = worries.filter((w) => w.depth_score !== null);
      const existing = await listCommitments(mapId);
      const alreadyCovered = new Set(existing.map((c) => c.worry_id));
      const uncoveredCount = locked.length - alreadyCovered.size;

      if (action.items.length !== uncoveredCount) {
        throw new Error(
          `propose_commitments_batch: expected ${uncoveredCount} items (one per uncovered worry), got ${action.items.length}.`,
        );
      }

      // Validate every index first so partial writes don't happen. Each
      // worry_index must resolve to a locked worry that doesn't already
      // have a commitment, and each worry must be covered exactly once
      // in this batch. Also reject garbled text on any item.
      const targets: { worryId: string; text: string }[] = [];
      const seenIndices = new Set<number>();
      for (const item of action.items) {
        if (looksLikeStructuredOutputLeakage(item.text)) {
          throw new Error(
            `propose_commitments_batch: item at worry_index ${item.worry_index} is garbled. Re-draft the whole batch cleanly.`,
          );
        }
        if (seenIndices.has(item.worry_index)) {
          throw new Error(
            `propose_commitments_batch: worry_index ${item.worry_index} appears twice in the batch.`,
          );
        }
        seenIndices.add(item.worry_index);
        const worry = locked[item.worry_index - 1];
        if (!worry) {
          throw new Error(
            `propose_commitments_batch: worry_index ${item.worry_index} out of range (${locked.length} locked).`,
          );
        }
        if (alreadyCovered.has(worry.id)) {
          throw new Error(
            `propose_commitments_batch: worry #${item.worry_index} already has a commitment.`,
          );
        }
        targets.push({
          worryId: worry.id,
          text: ensureStem(item.text, COMMITMENT_STEM),
        });
      }

      for (const t of targets) {
        await addCommitment(mapId, t.worryId, t.text);
      }
      return;
    }
    case "mark_reveal_delivered": {
      if (currentStage !== "commitments" && currentStage !== "assumptions") {
        return;
      }
      // Reveal is not allowed until every locked worry has a commitment.
      // Without this gate the coach delivers the summary text while the
      // map is still empty, the coachee notices, and the flow loops for
      // many turns as the coach tries to "lock them in" without firing
      // the batch. Reject here so the coach's next turn gets the
      // rejection feedback and is forced to run the batch first.
      const [worriesForReveal, commitmentsForReveal] = await Promise.all([
        listWorries(mapId),
        listCommitments(mapId),
      ]);
      const lockedWorries = worriesForReveal.filter(
        (w) => w.depth_score !== null,
      );
      const covered = new Set(commitmentsForReveal.map((c) => c.worry_id));
      const uncovered = lockedWorries.filter((w) => !covered.has(w.id));
      if (uncovered.length > 0) {
        throw new Error(
          `reveal blocked: ${uncovered.length} locked worries still have no commitment on the map. Fire propose_commitments_batch first, then deliver the reveal on the following turn.`,
        );
      }
      await markRevealDelivered(mapId);
      return;
    }
    case "mark_walkthrough_delivered": {
      if (currentStage !== "immune_system") return;
      await markWalkthroughDelivered(mapId);
      return;
    }
    case "propose_assumption": {
      if (currentStage !== "assumptions") return;
      if (looksLikeStructuredOutputLeakage(action.text)) {
        throw new Error(
          `propose_assumption: text is garbled (doubled stems or repeated fragments). Re-draft cleanly.`,
        );
      }
      const stemmedText = ensureStem(action.text, ASSUMPTION_STEM);
      const map = await getMapById(mapId);
      const rubric = await scoreAssumptionDepth({
        goalText: map?.improvement_goal ?? "",
        assumptionText: stemmedText,
      });
      if (rubric.score < 2) {
        throw new Error(
          `Big Assumption not landed yet (score ${rubric.score}/3): ${rubric.reason}. Extend the "then" until it hits identity or Big Time Bad — do not re-propose the same text.`,
        );
      }
      const commitments = await listCommitments(mapId);
      const linkedIds: string[] = [];
      for (const idx of action.commitment_indices) {
        const c = commitments[idx - 1];
        if (c) linkedIds.push(c.id);
      }
      if (linkedIds.length === 0) {
        throw new Error(
          `propose_assumption: commitment_indices resolved to no valid commitments.`,
        );
      }
      const assumption = await addAssumption(mapId, stemmedText, rubric.score);
      await linkAssumptionToCommitments(assumption.id, linkedIds);
      return;
    }
    case "recommend_assumption_for_testing": {
      if (currentStage !== "prioritize") return;
      const assumptions = await listAssumptions(mapId);
      const target = assumptions[action.assumption_index - 1];
      if (!target) {
        throw new Error(
          `recommend_assumption_for_testing: assumption_index ${action.assumption_index} out of range (${assumptions.length}).`,
        );
      }
      await setAssumptionRecommended(target.id, mapId);
      return;
    }
    case "select_assumption_for_testing": {
      // Allowed at prioritize AND test_design — if the coachee changes
      // his mind after auto-advance, the coach needs to be able to
      // update the selection without walking back a stage. Was
      // observed: coach recommended #1, cascade auto-selected #1,
      // advanced to test_design, coachee then asked for #2 — coach
      // couldn't fire the action to switch and the whole test was
      // built against the wrong assumption.
      if (currentStage !== "prioritize" && currentStage !== "test_design") {
        return;
      }
      const assumptions = await listAssumptions(mapId);
      const target = assumptions[action.assumption_index - 1];
      if (!target) {
        throw new Error(
          `select_assumption_for_testing: assumption_index ${action.assumption_index} out of range (${assumptions.length}).`,
        );
      }
      await setAssumptionSelected(target.id, mapId);
      return;
    }
    case "save_test_design": {
      if (currentStage !== "test_design") return;
      const assumptions = await listAssumptions(mapId);
      const selected = assumptions.find((a) => a.selected_for_testing);
      if (!selected) {
        throw new Error(
          `save_test_design: no assumption is selected_for_testing. Coach must fire select_assumption_for_testing at the prioritize stage first.`,
        );
      }
      await saveTestDraft({
        mapId,
        assumptionId: selected.id,
        testType: action.test_type,
        assumptionSays: action.assumption_says,
        behaviorChange: action.behavior_change,
        dataToCollect: action.data_to_collect,
        inOrderToFindOut: action.in_order_to_find_out,
        targetDate: action.target_date,
      });
      // Advance immediately so the "you drafted a test — go run it"
      // reply lands on the test_running stage.
      try {
        await advanceStage(mapId, "test_design", "test_running");
      } catch {
        // ignore — race or advance guard rejected
      }
      return;
    }
    case "record_test_results": {
      if (currentStage !== "test_running" && currentStage !== "results") {
        return;
      }
      const active = await getActiveTest(mapId);
      if (!active) {
        throw new Error(
          `record_test_results: no test on record for this map — cannot record results.`,
        );
      }
      await recordTestResult({
        testId: active.id,
        ranOn: action.ran_on,
        whatIDid: action.what_i_did,
        dataCollected: action.data_collected,
        whatItSaysAboutAssumption: action.what_it_says_about_assumption,
        assumptionVerdict: action.assumption_verdict,
        nextStep: action.next_step,
      });
      // Advance to results so the debrief lives in the results-stage
      // chat pane. next_step drives what happens after results (handled
      // by the coach's next turn via advance_stage back to test_design
      // or prioritize, or forward to done).
      if (currentStage === "test_running") {
        try {
          await advanceStage(mapId, "test_running", "results");
        } catch {
          // ignore
        }
      }
      return;
    }
    case "advance_stage": {
      const from = currentStage;
      const to = action.to;
      // Do the stage transition FIRST so its guards run. If it throws
      // (illegal transition, missing gate flag, etc.), the side
      // effects below don't fire. Previously markMapComplete ran
      // before advanceStage — meant a failed review→done attempt
      // would leave the map with status=complete AND stage=review,
      // which broke every downstream cascade.
      await advanceStage(mapId, from, to);
      // Side effects that depend on the transition succeeding. Kept
      // here (not inside advanceStage itself) so callers that go
      // backwards for OTHER reasons — e.g., a coach nudging back to
      // hone an entry — don't trigger accidental resets.
      if (from === "results" && to === "prioritize") {
        // Coachee wants to test a different assumption. Clear the pick
        // so prioritize can re-run cleanly.
        try {
          await clearSelectedAssumption(mapId);
        } catch {
          // non-fatal
        }
      }
      if (to === "done") {
        try {
          await markMapComplete(mapId);
        } catch {
          // non-fatal
        }
      }
      return;
    }
  }
}

const advanceSchema = z.object({
  map_id: z.string().uuid(),
  to: z.enum([
    "goal",
    "behaviors",
    "worries",
    "commitments",
    "assumptions",
    "review",
    "prioritize",
    "test_design",
    "test_running",
    "results",
    "done",
  ]),
});

export async function advanceMapStage(formData: FormData): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = advanceSchema.safeParse({
    map_id: formData.get("map_id"),
    to: formData.get("to"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid stage." };

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };

  const target = parsed.data.to as ItcStage;

  // Gate: cannot enter behaviors without a goal.
  if (target === "behaviors" && !map.improvement_goal) {
    return { ok: false, reason: "Save the goal first." };
  }
  // Gate: cannot leave behaviors without at least one behavior.
  if (map.current_stage === "behaviors" && target !== "behaviors") {
    const bs = await listBehaviors(map.id);
    if (bs.length === 0) return { ok: false, reason: "Add at least one behavior first." };
  }

  await advanceStage(map.id, map.current_stage, target);
  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
}
