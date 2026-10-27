import { z } from "zod";
import { generateObject, type ModelMessage } from "ai";
import { mainModel, mainModelIdOrUnset } from "@/lib/model-config";
import { buildCoachContext } from "@/lib/coach/context";
import { systemBase, PROMPT_VERSION, type Mode } from "@/lib/coach/prompts";
import { classifyMessage, CRISIS_RESOURCES } from "@/lib/coach/safety";
import { readAllowance, type AllowanceState } from "@/lib/coach/allowance";
import { checkCoachReply } from "@/lib/coach/degenerate-reply";
import { scrubCoachReply } from "@/lib/coach/scrub-reply";
import { addressNote, openingNote, workNote } from "@/lib/coach/address";
import { validateMissionConcreteness } from "@/lib/validation/mission";
import { fitSuggestion, loadCoachMissionPlan, type FitResult } from "@/lib/missions/coach-slots";
import { weekStartOf } from "@/lib/missions/rules";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { SessionUser } from "@/lib/session";
import type { PillarCode } from "@/lib/pillars";

// Only the five mission domains (2026-10-15). Holding the schema to them
// means a Movement or Network suggestion can't be generated at all; a goal
// mission's pillar is replaced with its goal's after generation.
const PillarEnum = z.enum(["B", "R", "A", "V", "E"]);

const CoachReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  mission_suggestion: z
    .object({
      description: z.string().min(1).max(280),
      pillar_code: PillarEnum,
      target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      /** Number from the "Open goals" list in the context, or null for a
       *  domain mission. The server maps it to the goal id. */
      goal_number: z.number().int().min(1).nullable(),
    })
    .nullable(),
});

type ModelReply = z.infer<typeof CoachReplySchema>;

/** What the client gets and what's stored: the model's suggestion with the
 *  goal resolved server-side. */
export type CoachReply = {
  reply: string;
  mission_suggestion:
    | (Omit<NonNullable<ModelReply["mission_suggestion"]>, "pillar_code"> & {
        /** The goal's pillar for a goal mission, else the domain chosen. */
        pillar_code: PillarCode;
        quarterly_goal_id: string | null;
        goal_label: string | null;
      })
    | null;
};

export type SendResult = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  reply: string;
  missionSuggestion: CoachReply["mission_suggestion"];
  allowance: AllowanceState;
  crisis: boolean;
};

/**
 * Assert the conversation exists, belongs to this user, and isn't archived.
 * Returns id + mode so the caller uses the conversation's stored mode rather
 * than trusting a client-supplied one.
 */
async function loadConversation(
  conversationId: string,
  userId: string,
): Promise<{ id: string; mode: Mode; hasTitle: boolean }> {
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("coach_conversations")
    .select("id, mode, user_id, title, archived_at")
    .eq("id", conversationId)
    .maybeSingle();
  const row = data as
    | { id: string; mode: Mode; user_id: string; title: string | null; archived_at: string | null }
    | null;
  if (!row) throw new Error("Conversation not found.");
  if (row.user_id !== userId) throw new Error("Not your conversation.");
  if (row.archived_at) throw new Error("Conversation is archived.");
  return { id: row.id, mode: row.mode, hasTitle: Boolean(row.title && row.title.trim()) };
}

/**
 * The prose out of a stored assistant row. Rows are JSON; older rows
 * and any hand-written one may be plain text, so fall back to the raw
 * string rather than dropping the turn.
 */
function assistantProse(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : content;
  } catch {
    return content;
  }
}

async function recentTurns(conversationId: string, limit = 20) {
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("coach_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as { role: "user" | "assistant"; content: string; created_at: string }[])
    .reverse();
}

/**
 * Assemble the system prompt string.
 *
 * The persona/mode/method prompt + the context pipeline's stable
 * prefix (identity/family/survey) form the cacheable region; the
 * volatile body (goals/missions/streaks/reflections/itc) + any
 * per-turn crisis note follow. Anthropic's automatic prompt caching
 * catches the stable prefix when the same string repeats across
 * turns — we don't need to pass `cache_control` breakpoints
 * explicitly because the SDK's stable-prefix caching already covers
 * the "put slow-changing content first" pattern the assembler
 * enforces.
 */
function buildSystemPrompt(
  mode: Mode,
  cacheablePrefix: string,
  volatileBody: string,
  /** Per-turn lines from address.ts: how to address him, how to open, how to talk about his work. */
  address: string,
  crisis: boolean,
): string {
  const parts: string[] = [
    `${systemBase(mode)}\n\n(prompt version: ${PROMPT_VERSION})`,
  ];
  if (cacheablePrefix) parts.push(cacheablePrefix);
  if (volatileBody) parts.push(volatileBody);
  parts.push(`# How to talk to him this turn\n${address}`);
  if (crisis) {
    parts.push(
      `# Crisis signal detected on this turn
The safety classifier flagged this message. A resource block will be automatically appended to your reply — do NOT include phone numbers or hotline text yourself. Acknowledge what he said, tell him someone from his community will reach out, and keep it short. Do not propose a mission this turn — set mission_suggestion to null.`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Main coach entry point. Runs safety classification, builds context, calls
 * the model with prompt caching, validates any mission suggestion, persists
 * both turns, and returns the reply.
 */
export async function sendCoachMessage(opts: {
  user: SessionUser;
  conversationId: string;
  userText: string;
}): Promise<SendResult> {
  const svc = createSupabaseServiceClient();
  const text = opts.userText.trim();
  if (text.length === 0) throw new Error("empty message");

  const allowanceBefore = await readAllowance(opts.user.id);
  if (allowanceBefore.bucket === "block") {
    throw new Error(
      `Monthly coach limit reached (${allowanceBefore.hardCap}). Resets on the 1st.`,
    );
  }

  const convo = await loadConversation(opts.conversationId, opts.user.id);
  const conversationId = convo.id;
  const mode: Mode = convo.mode;

  // 1. Safety classification (Haiku via AI SDK).
  const classification = await classifyMessage(text);
  const crisis =
    classification.severity === "high" || classification.severity === "critical";

  // 2. Persist the user turn immediately so it exists even if the model errors.
  const { data: userMsg } = await svc
    .from("coach_messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      content: text,
      flagged: classification.severity !== "none",
      flag_reason:
        classification.severity === "none"
          ? null
          : `${classification.severity}:${classification.categories.join(",")} — ${classification.reason}`,
    })
    .select("id")
    .single();
  const userMessageId = (userMsg as { id: string } | null)?.id ?? "";

  // Enqueue for admin review at medium+ (spec: medium is flagged for
  // review, no change to reply; high/critical also flagged AND trigger
  // the crisis resource append). Low/none don't hit the queue —
  // ordinary distress is coaching territory, not queue territory.
  const enqueueForReview =
    classification.severity === "medium" ||
    classification.severity === "high" ||
    classification.severity === "critical";
  if (enqueueForReview && userMessageId) {
    await svc.from("coach_flags_queue").insert({
      message_id: userMessageId,
      severity: classification.severity,
    });
  }

  // 3. Build context via the provider pipeline + history.
  const assembled = await buildCoachContext(opts.user);
  const history = await recentTurns(conversationId, 20);
  // Assistant rows are stored as JSON ({ text, mission_suggestion,
  // prompt_version }) because the client needs the suggestion
  // alongside the prose. The MODEL should see only the prose: fed
  // the raw column it reads a transcript in which the coach speaks
  // JSON, while generateObject simultaneously asks it to produce
  // JSON, and it re-sends prompt_version and mission_suggestion on
  // every turn for nothing.
  //
  // Not the cause of the 2026-09-03 failures, which do not reproduce
  // either way, but wrong on its own terms and cheap to correct.
  const historyMessages: ModelMessage[] = history.map((t) => ({
    role: t.role,
    content: t.role === "assistant" ? assistantProse(t.content) : t.content,
  }));

  const priorReplies = historyMessages.filter((m) => m.role === "assistant").map((m) => String(m.content));
  const systemPrompt = buildSystemPrompt(
    mode,
    assembled.cacheablePrefix,
    assembled.volatileBody,
    [
      addressNote(opts.user.first_name, priorReplies),
      openingNote(priorReplies),
      workNote(historyMessages.filter((m) => m.role === "user").map((m) => String(m.content))),
    ]
      .filter(Boolean)
      .join("\n"),
    crisis,
  );

  // 4. Coach call (Sonnet via AI SDK).
  let reply: ModelReply = {
    reply: "Coach is offline right now. Give it another try in a minute.",
    mission_suggestion: null,
  };
  let usageInput = 0;
  let usageCacheRead = 0;
  let usageCacheWrite = 0;
  let usageOutput = 0;
  /** Set when the first generation was not a usable reply. Lands on
   *  the assistant row so a recurrence is countable instead of
   *  depending on a coachee mentioning it. */
  let degenerateReason: string | null = null;

  try {
    const result = await generateObject({
      model: mainModel(),
      schema: CoachReplySchema,
      system: systemPrompt,
      messages: historyMessages,
      maxOutputTokens: 1600,
    });
    reply = result.object;
    usageInput = result.usage?.inputTokens ?? 0;
    usageOutput = result.usage?.outputTokens ?? 0;
    // Anthropic-specific token metadata on providerMetadata.
    const meta = result.providerMetadata?.anthropic as
      | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
      | undefined;
    usageCacheRead = meta?.cacheReadInputTokens ?? 0;
    usageCacheWrite = meta?.cacheCreationInputTokens ?? 0;
  } catch (err) {
    console.error("coach model call failed", err);
  }

  // 4b. Sanity-check the reply itself, and regenerate once if it is
  // not a reply at all.
  //
  // On 2026-09-03 a coachee got the single word "placeholder", asked
  // what it meant, and got an answer that opened mid-word ("y then
  // answer your question straight"). Both were transient model
  // failures: ten regenerations against that exact history came back
  // clean. What let them reach him is that nothing looked. The gate
  // below checks mission_suggestion, an optional side field, while
  // the reply text he actually reads had only z.string().min(1) in
  // front of it, which "placeholder" satisfies.
  //
  // One retry, then take the better of the two rather than fail:
  // a second glitch is unlikely, and showing him something imperfect
  // beats showing him an error.
  const firstVerdict = checkCoachReply(reply.reply);
  if (!firstVerdict.ok) {
    console.warn(
      "[coach] degenerate reply (%s), regenerating once: %o",
      firstVerdict.reason,
      reply.reply.slice(0, 120),
    );
    try {
      const retry = await generateObject({
        model: mainModel(),
        schema: CoachReplySchema,
        system: systemPrompt,
        messages: historyMessages,
        maxOutputTokens: 1600,
      });
      usageInput += retry.usage?.inputTokens ?? 0;
      usageOutput += retry.usage?.outputTokens ?? 0;
      const retryMeta = retry.providerMetadata?.anthropic as
        | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
        | undefined;
      usageCacheRead += retryMeta?.cacheReadInputTokens ?? 0;
      usageCacheWrite += retryMeta?.cacheCreationInputTokens ?? 0;
      // Keep the retry unless it is degenerate too and the first was
      // longer; never end up with less than we started with.
      const retryVerdict = checkCoachReply(retry.object.reply);
      if (retryVerdict.ok || retry.object.reply.length > reply.reply.length) {
        reply = retry.object;
      }
      degenerateReason = retryVerdict.ok
        ? `recovered: ${firstVerdict.reason}`
        : `unrecovered: ${firstVerdict.reason} then ${retryVerdict.reason}`;
    } catch (err) {
      console.error("coach degenerate-reply retry failed", err);
      degenerateReason = `retry threw: ${firstVerdict.reason}`;
    }
  }

  // 5. Validate mission_suggestion; one-shot retry if concreteness fails.
  if (reply.mission_suggestion) {
    const gate = validateMissionConcreteness({
      description: reply.mission_suggestion.description,
      target_date: reply.mission_suggestion.target_date,
    });
    if (!gate.ok) {
      try {
        const retry = await generateObject({
          model: mainModel(),
          schema: CoachReplySchema,
          system: systemPrompt,
          messages: [
            ...historyMessages,
            { role: "assistant", content: JSON.stringify(reply) },
            {
              role: "user",
              content: `That mission suggestion failed the concreteness gate: "${gate.reason}". Rewrite the mission_suggestion so the description starts with a concrete verb (call/text/take/write/book/plan/etc.) and names an observable behavior. Keep the target_date. Return the full JSON again.`,
            },
          ],
          maxOutputTokens: 1200,
        });
        const retryGate = retry.object.mission_suggestion
          ? validateMissionConcreteness({
              description: retry.object.mission_suggestion.description,
              target_date: retry.object.mission_suggestion.target_date,
            })
          : { ok: true as const };
        if (retryGate.ok) {
          reply = retry.object;
          usageInput += retry.usage?.inputTokens ?? 0;
          usageOutput += retry.usage?.outputTokens ?? 0;
          const retryMeta = retry.providerMetadata?.anthropic as
            | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
            | undefined;
          usageCacheRead += retryMeta?.cacheReadInputTokens ?? 0;
          usageCacheWrite += retryMeta?.cacheCreationInputTokens ?? 0;
        } else {
          reply = { ...reply, mission_suggestion: null };
        }
      } catch (err) {
        console.error("concreteness retry failed", err);
        reply = { ...reply, mission_suggestion: null };
      }
    }
  }

  // 5b. Fit the suggestion to his open slots. Same counting as the
  // weekly-cap trigger, so a card he can COMMIT is a card that will save.
  // A suggestion into a full slot (or under a goal that isn't open) gets
  // one retry with the reason; if it still doesn't fit, the card is
  // dropped and the reply says which slot is full rather than offering
  // something the app will refuse.
  let fit: FitResult | null = null;
  if (reply.mission_suggestion) {
    const first = reply.mission_suggestion;
    const plan = await loadCoachMissionPlan(opts.user.id, opts.user.timezone, [weekStartOf(first.target_date)]);
    fit = fitSuggestion(plan, first);
    if (!fit.ok) {
      const firstNote = fit.note;
      try {
        const retry = await generateObject({
          model: mainModel(),
          schema: CoachReplySchema,
          system: systemPrompt,
          messages: [
            ...historyMessages,
            { role: "assistant", content: JSON.stringify(reply) },
            {
              role: "user",
              content: `That mission suggestion doesn't fit his week: ${fit.reason} If a different open slot genuinely fits what he asked for, suggest that instead. Otherwise set mission_suggestion to null and tell him plainly in reply which slot is full. Return the full JSON again.`,
            },
          ],
          maxOutputTokens: 1200,
        });
        usageInput += retry.usage?.inputTokens ?? 0;
        usageOutput += retry.usage?.outputTokens ?? 0;
        const retryMeta = retry.providerMetadata?.anthropic as
          | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
          | undefined;
        usageCacheRead += retryMeta?.cacheReadInputTokens ?? 0;
        usageCacheWrite += retryMeta?.cacheCreationInputTokens ?? 0;
        const next = retry.object.mission_suggestion;
        if (!next) {
          reply = retry.object;
          fit = null;
        } else {
          const plan2 = await loadCoachMissionPlan(opts.user.id, opts.user.timezone, [weekStartOf(next.target_date)]);
          const fit2 = fitSuggestion(plan2, next);
          const gate2 = validateMissionConcreteness({ description: next.description, target_date: next.target_date });
          if (fit2.ok && gate2.ok && checkCoachReply(retry.object.reply).ok) {
            reply = retry.object;
            fit = fit2;
          }
        }
      } catch (err) {
        console.error("slot-fit retry failed", err);
      }
      if (fit && !fit.ok) {
        reply = { reply: `${reply.reply}\n\n${firstNote} Tell me if you want it in a different week or under a different domain.`, mission_suggestion: null };
        fit = null;
      }
    }
  }
  const resolvedSuggestion: CoachReply["mission_suggestion"] =
    reply.mission_suggestion && fit && fit.ok
      ? {
          ...reply.mission_suggestion,
          pillar_code: fit.pillar_code,
          quarterly_goal_id: fit.quarterly_goal_id,
          goal_label: fit.goal_label,
        }
      : null;

  // Scrub em-dashes / en-dashes out of the reply before persist +
  // return. The prompt bans them but no prompt rule survives every
  // generation; this is the output-boundary guarantee that a coachee
  // never sees one.
  const scrubbedReply = scrubCoachReply(reply.reply);
  const finalReplyText = crisis
    ? `${scrubbedReply}\n\n${CRISIS_RESOURCES}`
    : scrubbedReply;

  // 6. Persist the assistant turn with token usage + metadata.
  // metadata carries the context audit trail (which providers
  // contributed + their combined token estimate) and the safety
  // classification for the user turn this reply responded to. Both
  // land on the assistant row because that's the row admins review
  // when they want to know "what did the coach see when it said
  // this" — same pattern itc_turn_events uses on the ITC side.
  const inTokens = usageInput + usageCacheRead + usageCacheWrite;
  const metadata = {
    context: {
      providers: assembled.providerKeys,
      tokenEstimate: assembled.tokenEstimate,
    },
    safety: {
      severity: classification.severity,
      categories: classification.categories,
    },
    // Only present when the first generation was not a usable reply.
    // Makes the rate countable instead of waiting for a coachee to
    // mention it, which is how the 2026-09-03 pair was found.
    ...(degenerateReason ? { degenerate: degenerateReason } : {}),
  };
  const { data: asstMsg } = await svc
    .from("coach_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: JSON.stringify({
        text: finalReplyText,
        mission_suggestion: resolvedSuggestion,
        prompt_version: PROMPT_VERSION,
      }),
      model_used: mainModelIdOrUnset(),
      tokens_in: inTokens,
      tokens_out: usageOutput,
      metadata,
    })
    .select("id")
    .single();

  await svc
    .from("coach_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  // First-turn title generation. Uses next/server's `after()` so the
  // Haiku call outlives the HTTP response — a raw `void (async…)()`
  // gets orphaned when Vercel terminates the serverless invocation
  // right after the reply ships, which was why prod conversations
  // were staying labeled "New conversation" forever. `after` keeps
  // the work alive within the same invocation until it settles.
  if (!convo.hasTitle) {
    const { after } = await import("next/server");
    after(async () => {
      try {
        const { suggestConversationTitle } = await import("@/lib/coach/title");
        const title = await suggestConversationTitle({ mode, firstUserMessage: text });
        await svc
          .from("coach_conversations")
          .update({ title })
          .eq("id", conversationId)
          .is("title", null);
      } catch (err) {
        console.error("title backfill failed", err);
      }
    });
  }

  const allowanceAfter = await readAllowance(opts.user.id);

  return {
    conversationId,
    userMessageId,
    assistantMessageId: (asstMsg as { id: string } | null)?.id ?? "",
    reply: finalReplyText,
    missionSuggestion: resolvedSuggestion,
    allowance: allowanceAfter,
    crisis,
  };
}
