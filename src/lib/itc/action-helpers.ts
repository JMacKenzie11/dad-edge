/**
 * Shared helpers used by every server action in `src/app/itc/actions.ts`.
 *
 * Kept in a plain lib module (no `"use server"` directive) so these
 * helpers stay private to the server-side call graph — a "use server"
 * module would expose every export as a callable server action, which
 * these helpers are not.
 *
 * The actions file imports from here; nothing else should.
 */

import { revalidatePath } from "next/cache";
import {
  appendMessage,
  getMapById,
  getMapForParticipant,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMessages,
  listTestResults,
  listTests,
  listWorries,
} from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { TurnEventLog } from "@/lib/itc/turn-events";
import type {
  ReactionInput,
  ReactionOutput,
} from "@/lib/itc/coach";
import { generateCoachReaction } from "@/lib/itc/coach";

/** Uniform action-result shape returned by every server action. */
export type ActionResult = { ok: true } | { ok: false; reason: string };

/**
 * revalidatePath throws when called outside a Next.js request context
 * (test harness, cron, etc.). Never let a revalidation failure shadow
 * a successful write.
 */
export function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // no-op
  }
}

/**
 * Await the coach reaction inline so it lands in the database before
 * the server action returns. The client's auto-revalidate after a
 * form submit refetches messages + gets the reaction in the same
 * round trip.
 *
 * We originally used Next.js `after()` to defer this behind the
 * response, avoiding UI latency. But async landing meant the client
 * never re-rendered to see the reaction — it was in the DB, invisible
 * to the browser until a manual refresh. Reliability of the coach
 * reply beats the ~2-3s of extra latency on Add clicks.
 *
 * If the reaction itself throws, we swallow. The entry already
 * landed — a coach-service outage is not a form failure.
 */
export async function awaitReactionOrSwallow(
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(
      "[itc] coach reaction failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Resolve the current participant + verify they own this map. Returns
 * a discriminated union so callers can `if (!res.ok) return res;` and
 * bail cleanly with the reason string.
 */
export async function requireParticipantAndMap(mapId: string): Promise<
  | { ok: true; participant: Awaited<ReturnType<typeof requireItcParticipant>>; map: NonNullable<Awaited<ReturnType<typeof getMapForParticipant>>> }
  | { ok: false; reason: string }
> {
  const participant = await requireItcParticipant();
  const map = await getMapForParticipant(mapId, participant.id);
  if (!map) return { ok: false as const, reason: "Map not found." };
  return { ok: true as const, participant, map };
}

/**
 * Fetch the full map-state input the coach needs for a reaction /
 * chat / suggestions generation. Kept as a helper so every entry
 * point ships the same context shape.
 */
export async function loadCoachContext(mapId: string) {
  const map = await getMapById(mapId);
  if (!map) throw new Error("map not found");
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
  return {
    map,
    history: history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    context: {
      pillar: map.pillar_code,
      stage: map.current_stage,
      improvementGoal: map.improvement_goal,
      behaviors,
      worries: worries.map((w) => ({
        behavior_id: w.behavior_id,
        text: w.text,
        depth_score: w.depth_score,
      })),
      commitments: commitments.map((c) => ({
        id: c.id,
        worry_id: c.worry_id,
        text: c.text,
        depth_score: c.depth_score,
      })),
      assumptions: assumptions.map((a) => ({
        id: a.id,
        text: a.text,
        depth_score: a.depth_score,
        selected_for_testing: a.selected_for_testing,
        linked_commitment_ids: linksByAssumption.get(a.id) ?? [],
      })),
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
    },
  };
}

/**
 * Store a coach reaction as an assistant message. Refinement +
 * suggestions + suggested_pillar land in the message content as an
 * inline JSON footer the client parses out. Format:
 *
 *   <prose>
 *   ```coach-chips
 *   {"refinement":"...","suggestions":["..","..",".."],"suggested_pillar":"B"}
 *   ```
 *
 * The chat renderer splits on the fenced block and renders the prose
 * as text + chips as tap-to-fill buttons + a distinct "Switch to
 * [Pillar]" action button when suggested_pillar is present. Falls
 * back cleanly when the footer is absent.
 */
export async function persistReaction(
  mapId: string,
  stage: ItcStage,
  reaction: ReactionOutput,
  surface: "entry_thread" | "stage_note" | "dock" | "focus",
  anchor: { table: string; id: string } | null,
): Promise<string> {
  const parts: string[] = [reaction.reply];
  const hasChips =
    reaction.refinement ||
    (reaction.suggestions && reaction.suggestions.length > 0) ||
    reaction.suggested_pillar;
  if (hasChips) {
    const chipPayload = {
      refinement: reaction.refinement,
      suggestions: reaction.suggestions,
      suggested_pillar: reaction.suggested_pillar,
    };
    parts.push("```coach-chips", JSON.stringify(chipPayload), "```");
  }
  const msg = await appendMessage(
    mapId,
    "assistant",
    parts.join("\n\n"),
    stage,
    {
      surface,
      entryRefTable: anchor?.table,
      entryRefId: anchor?.id,
    },
  );
  return msg.id;
}

/**
 * Fire-and-forget async coach reaction to a just-added entry. Runs
 * after the server action's response is sent back to the client via
 * next/server's `after()` primitive, so the form submit is fast and
 * the coach reply appears on the next revalidation.
 *
 * The reply is written to itc_messages as an assistant message.
 * Refinement + suggestions chips are persisted as structured JSON in
 * a separate metadata column (added by migration) OR — for MVP —
 * embedded in the message content as a fenced JSON footer the client
 * strips out.
 */
export async function fireCoachReaction(
  mapId: string,
  justAdded: ReactionInput["justAdded"],
  anchor: { table: string; id: string },
): Promise<void> {
  const events = new TurnEventLog(mapId, 0);
  try {
    const { context, history } = await loadCoachContext(mapId);
    const recentChat = history.slice(-6);
    const reaction = await generateCoachReaction({
      ...context,
      recentChat,
      justAdded,
    });
    if (!reaction.reply.trim()) return;
    const stored = await persistReaction(
      mapId,
      context.stage,
      reaction,
      "entry_thread",
      anchor,
    );
    events.record(
      "coach_reaction_sent",
      {
        entry_kind: justAdded.kind,
        entry_text: justAdded.text,
        has_refinement: Boolean(reaction.refinement),
        suggestion_count: reaction.suggestions?.length ?? 0,
        message_id: stored,
        anchor_table: anchor.table,
        anchor_id: anchor.id,
      },
      { durationMs: reaction.durationMs, stage: context.stage },
    );
    await events.flush();
    safeRevalidate(`/itc/${mapId}`);
  } catch (err) {
    console.warn(
      "[itc] fireCoachReaction failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record("error", {
      where: "fireCoachReaction",
      message: err instanceof Error ? err.message : String(err),
    });
    try {
      await events.flush();
    } catch {
      // non-fatal
    }
  }
}
