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
  normalizeMapText,
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
import { extractActions } from "@/lib/itc/extract-actions";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { TurnEventLog } from "@/lib/itc/turn-events";
import {
  ASSUMPTION_STEM,
  COMMITMENT_STEM,
  GOAL_STEM,
  ITC_STAGES,
  WORRY_STEM,
  ensureStem,
  hasGoalStem,
  stageIndex,
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

  const prefetchStart = Date.now();
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
  const prefetchMs = Date.now() - prefetchStart;
  // Per-turn diagnostic buffer. Flushed as one bulk INSERT near the
  // end of the turn — no per-event round-trip overhead. Failures to
  // flush are non-fatal (see TurnEventLog.flush).
  const turnIndex = Math.max(
    0,
    Math.floor(
      history.filter((m) => m.role === "user" || m.role === "assistant")
        .length / 2,
    ),
  );
  const events = new TurnEventLog(map.id, turnIndex);
  events.record(
    "prefetch",
    { msgs: history.length },
    { durationMs: prefetchMs, stage: map.current_stage },
  );
  console.warn("[itc timing] prefetch ms=%d msgs=%d", prefetchMs, history.length);
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

  // Pull the last 3 server-feedback system messages so the coach's next
  // turn sees them (depth rubric rejections + silent dedup skips) and
  // can adjust instead of re-proposing the same content.
  const recentActionFeedback = history
    .filter(
      (m) =>
        m.role === "system" &&
        (m.content.startsWith("[action rejected]") ||
          m.content.startsWith("[dedup]")),
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
      onLlmAttempt: (ev) => {
        events.record(
          "llm_attempt",
          {
            kind: ev.kind,
            attempt: ev.attempt,
            outcome: ev.outcome,
          },
          { durationMs: ev.durationMs, stage: map.current_stage },
        );
      },
    });
    llmMs = Date.now() - llmStart;
  } catch (err) {
    llmMs = Date.now() - llmStart;
    const message = err instanceof Error ? err.message : "Coach unavailable.";
    await appendMessage(
      map.id,
      "system",
      `[coach error] ${message} (model=${process.env.ANTHROPIC_MODEL ?? "(unset)"})`,
      map.current_stage,
    );
    console.warn(
      "[itc timing] turn map=%s stage=%s llm=%dms total=%dms outcome=coach-error",
      map.id,
      map.current_stage,
      llmMs,
      Date.now() - turnStart,
    );
    events.record(
      "error",
      { where: "coach-llm", message },
      { durationMs: llmMs, stage: map.current_stage },
    );
    events.record(
      "turn_summary",
      {
        prefetch_ms: prefetchMs,
        llm_ms: llmMs,
        total_ms: Date.now() - turnStart,
        stage_from: map.current_stage,
        stage_to: map.current_stage,
        outcome: "coach-error",
      },
      { durationMs: Date.now() - turnStart, stage: map.current_stage },
    );
    await events.flush();
    return { ok: false, reason: `Coach: ${message}` };
  }

  const assistantMessage = await appendMessage(
    map.id,
    "assistant",
    reply.reply,
    map.current_stage,
  );

  // Extractor pass — the primary path for state changes. Reads the
  // just-completed turn plus current state and emits every action the
  // server should apply. Replaces the old regex-backstop + cascade +
  // reconciler-as-backstop dance with one focused LLM call.
  const extractStart = Date.now();
  // Widened from 3 to 6 assistant turns. The extractor needs to see
  // draft turns that may be several turns back on a chatty affirmation
  // sequence (e.g. coach drafts commitments, coachee asks a clarifying
  // question, coach answers, coachee affirms — that's the draft 3 turns
  // ago). 3 was too tight for the draft-and-affirm pattern.
  const recentAssistantMessages = priorHistory
    .filter((m) => m.role === "assistant")
    .slice(-6)
    .map((m) => m.content);
  const linksByAssumptionExtract = new Map<string, number[]>();
  const commitmentIndexById = new Map<string, number>();
  commitments.forEach((c, i) => commitmentIndexById.set(c.id, i + 1));
  for (const l of links) {
    const idx = commitmentIndexById.get(l.commitment_id);
    if (!idx) continue;
    const arr = linksByAssumptionExtract.get(l.assumption_id) ?? [];
    arr.push(idx);
    linksByAssumptionExtract.set(l.assumption_id, arr);
  }
  const selectedBehaviorsExtract = behaviors.filter((b) => b.selected);
  const behaviorIndexByIdExtract = new Map<string, number>();
  selectedBehaviorsExtract.forEach((b, i) =>
    behaviorIndexByIdExtract.set(b.id, i + 1),
  );
  const lockedWorriesExtract = worries.filter((w) => w.depth_score !== null);
  const worryIndexByIdExtract = new Map<string, number>();
  lockedWorriesExtract.forEach((w, i) =>
    worryIndexByIdExtract.set(w.id, i + 1),
  );
  const activeTestExtract =
    tests.find((t) => t.status === "designed" || t.status === "run") ??
    tests[tests.length - 1] ??
    null;
  const extraction = await extractActions({
    stage: map.current_stage,
    goalText: map.improvement_goal,
    behaviors: behaviors.map((b) => ({ text: b.text, selected: b.selected })),
    worries: worries.map((w) => ({
      behavior_index: behaviorIndexByIdExtract.get(w.behavior_id) ?? 0,
      text: w.text,
      locked: w.depth_score !== null,
    })),
    commitments: commitments.map((c) => ({
      worry_index: worryIndexByIdExtract.get(c.worry_id) ?? 0,
      text: c.text,
    })),
    assumptions: assumptions.map((a) => ({
      text: a.text,
      commitment_indices: linksByAssumptionExtract.get(a.id) ?? [],
      selected_for_testing: a.selected_for_testing,
      coach_recommended: a.coach_recommended,
    })),
    activeTest: activeTestExtract
      ? {
          test_type: activeTestExtract.test_type,
          assumption_says: activeTestExtract.assumption_says,
          behavior_change: activeTestExtract.behavior_change,
          data_to_collect: activeTestExtract.data_to_collect,
          in_order_to_find_out: activeTestExtract.in_order_to_find_out,
          target_date: activeTestExtract.target_date,
          status: activeTestExtract.status,
        }
      : null,
    walkthroughDelivered: map.walkthrough_delivered,
    userMessage: parsed.data.text,
    coachReply: reply.reply,
    recentAssistantMessages,
    recentActionRejections: recentActionFeedback,
  });
  const extractMs = extraction.durationMs;
  events.record(
    "extract",
    {
      emitted_actions: extraction.actions.map((a) => a.type),
      reason: extraction.reason,
    },
    { durationMs: extractMs, stage: map.current_stage },
  );

  // Apply each extracted action in order. Stage guards run against
  // the CURRENT stage after previous actions in the batch — so an
  // advance_stage earlier in the array lets a subsequent action land
  // at the new stage. Rejections are non-fatal and land as [action
  // rejected] system messages the extractor sees on the next turn.
  let appliedCount = 0;
  for (const action of extraction.actions) {
    const applyStart = Date.now();
    try {
      const mapNow = await getMapById(map.id);
      let stageNow: ItcStage = mapNow?.current_stage ?? map.current_stage;

      // Auto-cascade: if this action needs a stage the map hasn't
      // reached yet (or is past), walk the stage machine to the
      // required stage FIRST. Removes reliance on the extractor
      // getting action ordering right within a batch. If cascade
      // fails at an intermediate gate (e.g. can't advance to worries
      // without a selected behavior), the subsequent applyCoachAction
      // will throw a specific stage-mismatch error and land as an
      // [action rejected] the extractor sees next turn.
      const allowedStages = ACTION_ALLOWED_STAGES[action.type];
      if (allowedStages && !allowedStages.includes(stageNow)) {
        stageNow = await autoCascadeToActionStage(
          map.id,
          stageNow,
          allowedStages[0],
          events,
        );
      }

      await applyCoachAction(map.id, stageNow, action, events);
      appliedCount++;
      events.record(
        "action_apply",
        { action_type: action.type, applied: true, via: "extract" },
        { durationMs: Date.now() - applyStart, stage: stageNow },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendMessage(
        map.id,
        "system",
        `[action rejected] ${message}`,
        map.current_stage,
      );
      events.record(
        "action_rejected",
        { action_type: action.type, error: message, via: "extract" },
        { durationMs: Date.now() - applyStart, stage: map.current_stage },
      );
    }
  }

  // If the stage changed, retag the assistant message so it lives in
  // the new stage's chat pane rather than the one we just left.
  const finalMap = await getMapById(map.id);
  if (finalMap && finalMap.current_stage !== map.current_stage) {
    try {
      await retagMessageStage(assistantMessage.id, finalMap.current_stage);
    } catch {
      // non-fatal
    }
  }

  const stageChanged = finalMap && finalMap.current_stage !== map.current_stage;
  const totalMs = Date.now() - turnStart;
  const otherMs = totalMs - prefetchMs - llmMs - extractMs;
  console.warn(
    "[itc timing] turn map=%s stage=%s%s actions=%s prefetch=%dms llm=%dms extract=%dms(+%d) other=%dms total=%dms",
    map.id,
    map.current_stage,
    stageChanged ? `->${finalMap.current_stage}` : "",
    extraction.actions.map((a) => a.type).join(",") || "none",
    prefetchMs,
    llmMs,
    extractMs,
    appliedCount,
    otherMs,
    totalMs,
  );
  events.record(
    "turn_summary",
    {
      prefetch_ms: prefetchMs,
      llm_ms: llmMs,
      extract_ms: extractMs,
      extract_applied: appliedCount,
      other_ms: otherMs,
      total_ms: totalMs,
      stage_from: map.current_stage,
      stage_to: finalMap?.current_stage ?? map.current_stage,
      actions: extraction.actions.map((a) => a.type),
    },
    { durationMs: totalMs, stage: finalMap?.current_stage ?? map.current_stage },
  );
  await events.flush();

  try {
    revalidatePath(`/itc/${map.id}`);
  } catch {
    // no-op — outside a request context, no cache to invalidate
  }
  return { ok: true };
}

// ==========================================================================
// EVERYTHING BELOW THIS LINE was the old backstop + cascade + reconciler
// machinery. The extract-actions.ts module is now the primary path for
// state changes; the old code is deleted here. See git history if you
// need to see how it worked before.
// ==========================================================================



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
    looksLikeBareStatus(trimmed, null);
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



function assertStage(
  actionName: string,
  currentStage: ItcStage,
  allowed: readonly ItcStage[],
): void {
  if (!allowed.includes(currentStage)) {
    const allowedList = allowed.join("/");
    throw new Error(
      `${actionName}: only valid at stage ${allowedList} (current: ${currentStage}). Do NOT re-fire the same action — first move the map into a valid stage (or check whether the prerequisite step landed) and try again.`,
    );
  }
}

/**
 * Which stages each coach action is valid at. Keep in sync with the
 * assertStage() calls in applyCoachAction below. Used by
 * autoCascadeToActionStage() to walk the stage machine up (or back)
 * to a stage where the action can land, so the extractor doesn't have
 * to get action ordering right within a batch.
 *
 * null = valid at any stage (only advance_stage — the stage machine
 * itself enforces legality via canTransitionTo).
 */
const ACTION_ALLOWED_STAGES: Record<CoachAction["type"], ItcStage[] | null> = {
  propose_goal: ["goal"],
  propose_behavior: ["behaviors"],
  suggest_behaviors: ["behaviors"],
  replace_behavior: ["behaviors"],
  remove_behavior: ["behaviors"],
  propose_worry: ["worries"],
  propose_commitment: ["commitments"],
  propose_commitments_batch: ["commitments"],
  mark_reveal_delivered: ["commitments", "assumptions"],
  mark_walkthrough_delivered: ["immune_system"],
  propose_assumption: ["assumptions"],
  recommend_assumption_for_testing: ["prioritize"],
  select_assumption_for_testing: ["prioritize", "test_design"],
  save_test_design: ["test_design"],
  record_test_results: ["test_running", "results"],
  advance_stage: null,
};

/**
 * Walk the stage machine from currentStage toward targetStage, one
 * legal step at a time. Returns the stage we ended up at (which may
 * be short of the target if an intermediate gate rejected — e.g.
 * can't advance to worries without a selected behavior).
 *
 * Backward walks skip gates (advanceStage allows toIdx <= fromIdx
 * unconditionally); forward walks respect them.
 *
 * Called BEFORE each coach action apply so extract-actions doesn't
 * have to get action ordering right within a batch. The old flow
 * required the extractor to put advance_stage before any downstream
 * action that needed a new stage; missing the ordering meant silent
 * rejections. This makes ordering LLM-independent.
 */
async function autoCascadeToActionStage(
  mapId: string,
  currentStage: ItcStage,
  targetStage: ItcStage,
  events: TurnEventLog,
): Promise<ItcStage> {
  let stage = currentStage;
  // Bounded walk — 12 stages total, cascading through all of them is
  // the worst case. Anything more is a bug.
  for (let step = 0; step < 12; step++) {
    if (stage === targetStage) return stage;
    const stageIdx = stageIndex(stage);
    const targetIdx = stageIndex(targetStage);
    // Pick the next hop: for forward walks, use the stage-machine's
    // +1 rule (plus the assumptions→immune_system skip). For
    // backward walks, jump straight to targetStage (backward
    // transitions are always allowed).
    let nextHop: ItcStage;
    if (targetIdx > stageIdx) {
      // Forward. Special case: assumptions → immune_system skip.
      if (stage === "assumptions" && targetStage === "immune_system") {
        nextHop = "immune_system";
      } else {
        nextHop = ITC_STAGES[stageIdx + 1] as ItcStage;
      }
    } else {
      // Backward — jump directly.
      nextHop = targetStage;
    }
    try {
      await advanceStage(mapId, stage, nextHop);
      events.record(
        "action_apply",
        {
          action_type: "advance_stage",
          applied: true,
          via: "auto-cascade",
          from: stage,
          to: nextHop,
        },
        { stage: nextHop },
      );
      stage = nextHop;
    } catch (err) {
      // Gate rejected (e.g. missing a selected behavior for
      // worries). Return what we've reached — the caller's action
      // will re-throw with a specific error if the stage still
      // doesn't allow it, and that error surfaces the actual gate
      // reason.
      console.warn(
        "[itc] auto-cascade: stage-machine step %s -> %s rejected: %s",
        stage,
        nextHop,
        err instanceof Error ? err.message : String(err),
      );
      return stage;
    }
  }
  return stage;
}

async function applyCoachAction(
  mapId: string,
  currentStage: ItcStage,
  action: CoachAction,
  events?: TurnEventLog,
): Promise<void> {
  // Record + surface a dedup skip to both the diagnostic log and the
  // chat transcript. add* functions in maps.ts return { row, deduped }
  // now; when a duplicate is silently absorbed by their normalized-text
  // check, this helper emits a dedup_skip event AND appends a system
  // message so the extractor sees the outcome on its next turn.
  // Without this, the map silently swallows entries the extractor
  // thinks it just landed — the event log said 'applied' but the DB
  // effect was a no-op.
  const recordDedup = async (kind: string, text: string): Promise<void> => {
    events?.record(
      "dedup_skip",
      { kind, text },
      { stage: currentStage },
    );
    await appendMessage(
      mapId,
      "system",
      `[dedup] ${kind} "${text.length > 120 ? text.slice(0, 120) + "…" : text}" is a duplicate of an existing entry — nothing new landed. If this was intended as a REFINEMENT of an existing entry, use replace_behavior (for behaviors) with the index of the existing one instead of propose_behavior.`,
      currentStage,
    );
  };
  switch (action.type) {
    case "propose_goal": {
      // Save the proposed goal to improvement_goal so it shows up on the
      // map immediately. Coachee sees the draft as he's being asked to
      // affirm it; if he tweaks, coach re-fires propose_goal with the new
      // text and this handler overwrites. Was previously a no-op —
      // relying on a downstream backstop to persist on affirmation. That
      // pattern kept losing goals when the affirmation was implicit
      // (e.g. coachee jumped straight to a behavior). Persist here and
      // never lose it.
      assertStage("propose_goal", currentStage, ["goal"]);
      await saveImprovementGoal(mapId, action.text);
      return;
    }
    case "propose_behavior": {
      assertStage("propose_behavior", currentStage, ["behaviors"]);
      const result = await addBehavior(mapId, action.text, "suggested");
      if (result.deduped) await recordDedup("behavior", action.text);
      return;
    }
    case "suggest_behaviors": {
      // Suggestions are surfaced in the reply text only. The coachee reads
      // them, picks one (or writes his own), and the coach emits
      // propose_behavior on the next turn to land it on the map.
      return;
    }
    case "replace_behavior": {
      assertStage("replace_behavior", currentStage, ["behaviors"]);
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
      assertStage("propose_worry", currentStage, ["worries"]);
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
      assertStage("propose_commitment", currentStage, ["commitments"]);
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
      const cResult = await addCommitment(mapId, worry.id, stemmedText);
      if (cResult.deduped) await recordDedup("commitment", stemmedText);
      return;
    }
    case "propose_commitments_batch": {
      assertStage("propose_commitments_batch", currentStage, ["commitments"]);
      const worries = await listWorries(mapId);
      const locked = worries.filter((w) => w.depth_score !== null);
      const existing = await listCommitments(mapId);
      const alreadyCovered = new Set(existing.map((c) => c.worry_id));

      // Idempotent: filter to items whose worry is uncovered, skip the
      // rest. Old behavior rejected the whole batch if item count
      // didn't equal uncovered count — but the reconciler and worries
      // backstops can land a commitment or two mid-flow, leaving the
      // coach with a batch of N and only N-K worries uncovered. That
      // shouldn't kill the batch; the K items pointing at
      // already-covered worries are just duplicates the coach didn't
      // know about.
      const targets: { worryId: string; text: string; index: number }[] = [];
      const skippedIndices: number[] = [];
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
          skippedIndices.push(item.worry_index);
          continue;
        }
        targets.push({
          worryId: worry.id,
          text: ensureStem(item.text, COMMITMENT_STEM),
          index: item.worry_index,
        });
      }

      for (const t of targets) {
        const bResult = await addCommitment(mapId, t.worryId, t.text);
        if (bResult.deduped) await recordDedup("commitment", t.text);
      }
      if (skippedIndices.length > 0) {
        console.warn(
          "[itc] propose_commitments_batch: skipped %d already-covered worries (indices=%o), applied %d",
          skippedIndices.length,
          skippedIndices,
          targets.length,
        );
      }
      return;
    }
    case "mark_reveal_delivered": {
      assertStage("mark_reveal_delivered", currentStage, [
        "commitments",
        "assumptions",
      ]);
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
      assertStage("mark_walkthrough_delivered", currentStage, ["immune_system"]);
      await markWalkthroughDelivered(mapId);
      return;
    }
    case "propose_assumption": {
      assertStage("propose_assumption", currentStage, ["assumptions"]);
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
      const aResult = await addAssumption(mapId, stemmedText, rubric.score);
      if (aResult.deduped) await recordDedup("assumption", stemmedText);
      await linkAssumptionToCommitments(aResult.row.id, linkedIds);
      return;
    }
    case "recommend_assumption_for_testing": {
      assertStage("recommend_assumption_for_testing", currentStage, [
        "prioritize",
      ]);
      const assumptions = await listAssumptions(mapId);
      const target = assumptions[action.assumption_index - 1];
      if (!target) {
        throw new Error(
          `recommend_assumption_for_testing: assumption_index ${action.assumption_index} out of range (${assumptions.length}).`,
        );
      }
      await setAssumptionRecommended(target.id, mapId);
      // Also set selected_for_testing on the same assumption. The
      // recommendation is a proposal for the pick; if the coachee
      // silently accepts (says "sounds good" / "let's go with that"
      // / anything that doesn't match looksAffirmative's word list),
      // the cascade previously never fired select_assumption_for_testing
      // and the map got stuck in prioritize — save_test_design would
      // then reject on the wrong-stage guard and the whole test
      // conversation happened without landing anywhere. Setting the
      // selection here makes the pick durable immediately. If the
      // coachee actually asks for a DIFFERENT one, the coach fires
      // select_assumption_for_testing with the new index, which
      // overwrites this one via setAssumptionSelected's single-active
      // constraint.
      await setAssumptionSelected(target.id, mapId);
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
      assertStage("select_assumption_for_testing", currentStage, [
        "prioritize",
        "test_design",
      ]);
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
      assertStage("save_test_design", currentStage, ["test_design"]);
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
      assertStage("record_test_results", currentStage, [
        "test_running",
        "results",
      ]);
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
