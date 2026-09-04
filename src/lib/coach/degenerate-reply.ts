/**
 * Sanity check on the coach's own reply, before a man reads it.
 *
 * WHY. On 2026-09-03 a real coaching conversation produced two bad
 * turns in a row. The first was the single word "placeholder"
 * (tokens_out 25). The man asked "what does placeholder mean", and
 * the next reply opened mid-word: "y then answer your question
 * straight." (tokens_out 238, so the model wrote a full answer and
 * the front of it was missing).
 *
 * Neither reproduces. Ten regenerations against the exact history,
 * with and without the JSON wrapper the history carries, came back
 * clean every time. They were transient model failures, which means
 * they will happen again and no amount of prompt work prevents them.
 *
 * What made them reach the coachee is that nothing looked. The
 * pipeline has a concreteness gate on mission_suggestion, an optional
 * side field, and no check at all on the reply text, which is the
 * only part he actually reads. CoachReplySchema asks for
 * z.string().min(1), and "placeholder" satisfies that.
 *
 * DELIBERATELY DETERMINISTIC. No model call: a judge that decides
 * whether a reply is broken is itself a generation that can be
 * broken, and these failures are shape failures a regex can see.
 *
 * DELIBERATELY NARROW. Every rule here fires on text no coach would
 * ever write. The cost of a false positive is one extra generation,
 * so the bar is "obviously not a reply", not "not a great reply".
 * Quality is the prompt's job.
 */

/** Scaffolding a model emits when it loses the thread of the task. */
const SCAFFOLDING = /^(placeholder|todo|tbd|n\/a|none|null|undefined|lorem ipsum|\[.*\]|<.*>)\.?$/i;

export type ReplyVerdict = {
  ok: boolean;
  /** Which rule fired, for the turn-event log. Null when ok. */
  reason: string | null;
};

export function checkCoachReply(text: string): ReplyVerdict {
  const t = text.trim();

  if (t.length === 0) return { ok: false, reason: "empty" };

  // "placeholder", "TODO", "[your response here]".
  if (SCAFFOLDING.test(t)) {
    return { ok: false, reason: `scaffolding: ${JSON.stringify(t.slice(0, 40))}` };
  }

  // A coach reply is a few sentences. Anything this short is a
  // fragment or a stub; the shortest real reply in the thread that
  // produced this check was 96 output tokens.
  if (t.length < 40) {
    return { ok: false, reason: `too short (${t.length} chars)` };
  }

  // Starts mid-word or mid-sentence. This is the "y then answer your
  // question straight" signature: the model wrote a whole reply and
  // the opening is missing.
  //
  // Openers that legitimately begin lowercase are quotes and ellipses,
  // so only a bare letter counts.
  if (/^[a-z]/.test(t)) {
    return {
      ok: false,
      reason: `starts mid-sentence: ${JSON.stringify(t.slice(0, 40))}`,
    };
  }

  // One word, however long. A real reply asks or says something.
  if (!/\s/.test(t)) {
    return { ok: false, reason: `single word: ${JSON.stringify(t.slice(0, 40))}` };
  }

  return { ok: true, reason: null };
}
