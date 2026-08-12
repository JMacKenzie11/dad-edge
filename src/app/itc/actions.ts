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
      revealDelivered: map.reveal_delivered,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Coach unavailable.";
    await appendMessage(
      map.id,
      "system",
      `[coach error] ${message} (model=${process.env.ITC_COACH_MODEL || "claude-sonnet-5"})`,
      map.current_stage,
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
  if (
    reply.action?.type !== "propose_commitments_batch" &&
    looksLikeCommitmentAffirmation(parsed.data.text, reply.reply)
  ) {
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
      // Mark reveal_delivered too — the batch handler does this on the
      // normal path (trusting the prompt that reveal is in the batch
      // turn's reply). Backstop path skips the handler and inserts
      // directly, so we mark here to match. Prevents the downstream
      // review → immune_system advance gate from silently failing.
      try {
        await markRevealDelivered(map.id);
      } catch {
        // non-fatal — may already be marked
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
        // Only advance if every locked worry has a commitment AND
        // the reveal has been delivered. Reveal_delivered is set by
        // the propose_commitments_batch handler (which trusts the
        // prompt that the reveal narrative is in the batch turn's
        // reply). If we're still in commitments and reveal is not
        // delivered, don't advance — the coach hasn't finished the
        // reveal + reflection beat and skipping it drops the whole
        // point of Column 3's gas-and-brake moment.
        //
        // Additional guard: if the current turn's action IS the
        // batch itself, do NOT advance on this turn — the coachee is
        // still reading the reveal narrative that just landed. Wait
        // for their next affirmation.
        if (reply.action?.type === "propose_commitments_batch") {
          // Batch just fired this turn; hold on advance so the
          // coachee has a beat to reflect on the reveal.
          break;
        }
        const [worriesNow, commitmentsNow] = await Promise.all([
          listWorries(map.id),
          listCommitments(map.id),
        ]);
        const lockedWorries = worriesNow.filter((w) => w.depth_score !== null);
        const covered = new Set(commitmentsNow.map((c) => c.worry_id));
        const uncoveredWorries = lockedWorries.filter((w) => !covered.has(w.id));
        if (
          lockedWorries.length > 0 &&
          uncoveredWorries.length === 0 &&
          currentMap.reveal_delivered
        ) {
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
        // The review → immune_system advance gate requires
        // reveal_delivered=true. If it's still false at this point
        // (backstop path skipped the marking, or the coach delivered
        // the reveal text without the batch action firing), auto-mark
        // it here. We're already past the reveal beat conceptually —
        // the user got to review, which means commitments landed and
        // the map is complete. Blocking the cascade over this state
        // flag is worse than trusting the flow forward.
        if (!currentMap.reveal_delivered) {
          try {
            await markRevealDelivered(map.id);
          } catch {
            // ignore
          }
        }
        try {
          await advanceStage(map.id, "review", "immune_system");
          advanced = true;
        } catch {
          // ignore
        }
      } else if (from === "immune_system") {
        if (!currentMap.walkthrough_delivered) {
          try {
            await markWalkthroughDelivered(map.id);
          } catch {
            // ignore
          }
        }
        try {
          await advanceStage(map.id, "immune_system", "prioritize");
          advanced = true;
        } catch {
          // ignore
        }
      } else if (from === "prioritize") {
        // Advance to test_design only if a pick is on record. If the
        // coach recommended one and the coachee affirmed without an
        // explicit select, auto-adopt the recommendation as the
        // selection — his "yes" reasonably endorses the coach's pick.
        const assumptionsNow = await listAssumptions(map.id);
        const alreadySelected = assumptionsNow.find(
          (a) => a.selected_for_testing,
        );
        if (!alreadySelected) {
          const recommended = assumptionsNow.find((a) => a.coach_recommended);
          const fallback = recommended ?? assumptionsNow[0];
          if (fallback) {
            try {
              await setAssumptionSelected(fallback.id, map.id);
            } catch {
              // ignore
            }
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
          try {
            await markMapComplete(map.id);
          } catch {
            // ignore
          }
          try {
            await advanceStage(map.id, "results", "done");
            advanced = true;
          } catch {
            // ignore
          }
        }
      }

      if (!advanced) break;
    }
  }

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

  revalidatePath(`/itc/${map.id}`);
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
  // Two garbage shapes to catch: (a) zero letters (`.}` etc.) and (b)
  // JSON-fragment leakage where the reply has letters but is polluted
  // with schema keys / bracket bleed / model self-disclaimers. The
  // per-attempt loop inside runItcCoachTurn already retries on (b); this
  // is the belt-and-suspenders backup in case leakage still lands here.
  const isNoLetters = !isEmpty && !/[A-Za-z]/.test(trimmed);
  const isJsonLeakage = !isEmpty && looksLikeStructuredOutputLeakage(trimmed);
  const isGarbage = isNoLetters || isJsonLeakage;
  if (!isEmpty && !isDupe && !isGarbage) return first;

  if (isGarbage) {
    console.warn(
      "[itc] coach reply looked like garbage (%s), regenerating. raw=%o",
      isJsonLeakage ? "json-leakage" : "no-letters",
      first.reply,
    );
  }

  const nudge = isEmpty
    ? "Your previous attempt returned empty. Produce a real reply this time."
    : isGarbage
      ? "Your previous attempt included JSON-fragment artifacts or non-prose characters in the reply text. Write plain prose the coachee can read — no schema keys, no bracket sequences, no meta-commentary about formatting."
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

// Pulls numbered "I'm also committed to ..." drafts out of an assistant
// message. Tolerant of smart-apostrophes and leading whitespace. Order is
// preserved — the caller aligns index N to the Nth locked worry.
function extractCommitmentDrafts(text: string): string[] {
  const drafts: string[] = [];
  const re = /^\s*\d+[.)]\s+(I[\u2019'\u02BC]?m also committed to [^\n]+?)\s*$/i;
  for (const rawLine of text.split("\n")) {
    const m = rawLine.match(re);
    if (!m) continue;
    // Canonicalize the "I'm" apostrophe so ensureStem matches.
    const draft = m[1]
      .replace(/^I[\u2019\u02BC]?m/i, "I'm")
      .replace(/[.!?]+$/, "")
      .trim();
    if (draft.length > 0) drafts.push(draft);
  }
  return drafts;
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
    /^(yeah|yes|ok|sure|good)[\s,]+(let['\u2019]?s|move|go)\b/,
    /^(next|next step|move on|keep going|continue)\b/,
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
      // Auto-mark reveal_delivered — the prompt for Turn 2 of the
      // commitments batch REQUIRES the reply to include the reveal
      // narrative + "What's it like to see that?" question in the same
      // turn as the batch. Marking here keeps the downstream review /
      // immune_system gates from blocking on a missing action while
      // trusting the prompt that reveal is in the reply text.
      try {
        await markRevealDelivered(mapId);
      } catch {
        // non-fatal — reveal may already be marked
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
      if (currentStage !== "prioritize") return;
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
      // Side effects on late-stage backward jumps. Kept here (not in
      // advanceStage itself) so callers that go backwards for other
      // reasons — e.g., a coach nudging back to hone an entry — don't
      // trigger accidental resets.
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
      await advanceStage(mapId, from, to);
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
