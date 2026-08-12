"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { runItcCoachTurn, type CoachAction } from "@/lib/itc/coach";
import {
  addAssumption,
  addBehavior,
  addCommitment,
  advanceStage,
  appendMessage,
  countWorryAttempts,
  createMap,
  deleteMap,
  findInProgressMap,
  getMapById,
  getMapForParticipant,
  linkAssumptionToCommitments,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMessages,
  listWorries,
  logWorryAttempt,
  markRevealDelivered,
  markWalkthroughDelivered,
  retagMessageStage,
  saveImprovementGoal,
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

  const [history, behaviors, worries, commitments, assumptions, links] =
    await Promise.all([
      listMessages(map.id),
      listBehaviors(map.id),
      listWorries(map.id),
      listCommitments(map.id),
      listAssumptions(map.id),
      listAssumptionLinks(map.id),
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

  // Auto-advance worries → commitments the moment the last worry lands.
  // The coach can only emit one action per turn, so on the last-worry
  // turn it's forced to spend the slot on propose_worry — which means
  // advance_stage can't fire from the coach side. Handling it here means
  // the transition reply (which per prompt already includes the
  // commitments intro + drafted list) becomes the first message of the
  // commitments stage via the retag block below, and the coachee doesn't
  // have to type "ok" to unstick the flow.
  if (
    map.current_stage === "worries" &&
    reply.action?.type === "propose_worry"
  ) {
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
  // A well-formed coach reply always contains at least one letter. Zero
  // letters means we got a JSON-fragment artifact (e.g. `.}`) that
  // slipped through the schema's min(1) check.
  const isGarbage = !isEmpty && !/[A-Za-z]/.test(trimmed);
  if (!isEmpty && !isDupe && !isGarbage) return first;

  if (isGarbage) {
    console.warn(
      "[itc] coach reply looked like JSON-fragment garbage, regenerating. raw=%o",
      first.reply,
    );
  }

  const nudge = isEmpty
    ? "Your previous attempt returned empty. Produce a real reply this time."
    : isGarbage
      ? "Your previous attempt returned characters that were not a real reply. Write plain prose the coachee can read."
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

// Very permissive affirmation detector — the only cost of a false positive
// is auto-advancing to behaviors, which the coachee can still walk back.
function looksAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (t.length === 0 || t.length > 60) return false;
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
  return affirmations.includes(t);
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
      // in this batch.
      const targets: { worryId: string; text: string }[] = [];
      const seenIndices = new Set<number>();
      for (const item of action.items) {
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
      const map = await getMapById(mapId);
      const rubric = await scoreAssumptionDepth({
        goalText: map?.improvement_goal ?? "",
        assumptionText: action.text,
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
      const assumption = await addAssumption(mapId, action.text, rubric.score);
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
    case "advance_stage": {
      await advanceStage(mapId, currentStage, action.to);
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
