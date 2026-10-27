/**
 * How Larry addresses the member this turn. The voice guide's "at most
 * once per reply, and plenty without" lost to the model: on the first
 * day live it said "brother" or "man" in nearly every reply. So the
 * server decides, from the replies already in the conversation, and
 * tells the model in one line (DECISIONS.md "Coach Larry: his name
 * first, brother and man sparingly").
 *
 * - First reply: his first name once, never "brother" or "man".
 * - After that: nothing while any of the last three replies used one,
 *   then one is allowed, not required. At most one reply in four.
 */

/** Replies that must pass without one before another is allowed. */
const GAP = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when a reply addresses him: "brother", "my man", "man" said to
 * him ("Hey man", ", man."), or his first name. "The man changes first"
 * doesn't count.
 */
export function usesAddressTerm(text: string, firstName: string | null): boolean {
  if (/\bbrother\b/i.test(text) || /\bmy man\b/i.test(text)) return true;
  if (/\b(hey|yeah|okay|ok|look|listen)\s+man\b/i.test(text) || /,\s*man\b/i.test(text)) return true;
  const name = firstName?.trim();
  return !!name && new RegExp(`\\b${escapeRe(name)}\\b`).test(text);
}

/** The per-turn instruction, given his first name and Larry's earlier replies in this conversation, oldest first. */
export function addressNote(firstName: string | null, priorReplies: string[]): string {
  const name = firstName?.trim() || null;
  const none = `Don't call him by name, "brother", "man" or "my man" in this reply.`;
  if (priorReplies.length === 0) {
    return name ? `Use his first name, ${name}, once in this reply. Don't call him "brother" or "man".` : none;
  }
  if (priorReplies.slice(-GAP).some((r) => usesAddressTerm(r, name)) || priorReplies.length < GAP) return none;
  return name
    ? `You can call him ${name}, "brother" or "man" once in this reply if it fits, or not at all.`
    : `You can call him "brother" or "man" once in this reply if it fits, or not at all.`;
}

/**
 * How Larry talks about his work this turn. Not every member runs a
 * business, and a "Business owner" profile alone made the model say
 * "the business" in most first replies even with a prompt rule against
 * it. His own words decide: until he mentions a business, it's "work".
 * Empty once he has.
 */
export function workNote(memberMessages: string[]): string {
  const said = memberMessages.some((m) => /\b(business(es)?|company|my firm|my practice|my shop|my store)\b/i.test(m));
  return said
    ? ""
    : `Call his work "work" or "your job". Don't say "the business", "your business" or "your company": he hasn't told you he runs one, whatever his profile says.`;
}

/**
 * The first reply's opener. "I hear you" is on the voice guide's never
 * list, yet 10 of 16 first replies to "I'm struggling man" opened with
 * it, and none after the first. So the first reply gets told directly.
 * Empty after that.
 */
export function openingNote(priorReplies: string[]): string {
  return priorReplies.length === 0
    ? `Don't say "I hear you". Thank him for saying it, or go straight to your question.`
    : "";
}
