/**
 * Pure text-extraction helpers used by the server-side backstops in
 * src/app/itc/actions.ts. Kept in their own module so they can be
 * unit-tested without spinning up the whole request pipeline.
 *
 * A backstop fires when the coach's reply text claims a state change
 * ("Locked", "Two on the map", "I assume that ...") but the
 * corresponding action never landed. These helpers convert that
 * loose text into structured guesses so the server can insert the
 * missing row.
 *
 * Every helper is intentionally conservative: false-positives here
 * corrupt the map, false-negatives just mean the coach's next turn
 * has another chance to fire the action itself.
 */

/**
 * True when the user's message looks like a candidate behavior — short
 * first-person or "when X" construction. Filters out questions,
 * directives, affirmations, and long screeds so the behaviors backstop
 * doesn't accidentally treat "yeah, that's a good one" as a behavior
 * to insert.
 */
export function looksLikeBehaviorCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < 5 || t.length > 200) return false;
  if (t.includes("?")) return false;
  if (t.includes("\n\n")) return false;
  if (/^\s*\d+[.)]\s+/m.test(t)) return false;
  const lower = t.toLowerCase();
  const starters = [
    /^i\s/,
    /^i['\u2019]m\s/,
    /^i\s?don['\u2019]?t\s/,
    /^when\s/,
    /^if\s/,
    /^sometimes\s/,
    /^usually\s/,
  ];
  if (!starters.some((re) => re.test(lower))) return false;
  const affirmationish =
    /^i\s?(get it|agree|see|understand|will|would|think that['\u2019]s|feel that['\u2019]s)\b/i;
  if (affirmationish.test(t)) return false;
  return true;
}

/**
 * True when the coach's reply asserts a new behavior just landed. Two
 * shape families: count-claim ("Two on the map so far", "Three on the
 * map now") and ordinal-claim ("That's a second one", "adds another",
 * "another sharp one").
 */
export function coachAcknowledgedNewBehavior(replyText: string): boolean {
  const t = replyText.toLowerCase();
  if (/\b(one|two|three|four|five|\d+)\s+on the map\b/.test(t)) return true;
  if (
    /\bthat['\u2019]?s (a|the) (second|third|fourth|fifth|next)\s+\w*\s?one\b/.test(
      t,
    )
  )
    return true;
  if (
    /\b(that works as one|adds another|another sharp one|another real move|solid one|sharp one|real move)\b/.test(
      t,
    )
  )
    return true;
  return false;
}

/**
 * Pulls a count out of the coach's reply text. Returns null when no
 * count claim is present. Only matches the "N on the map" style — the
 * canonical recap phrasing in the behaviors-stage prompt.
 */
export function extractCoachBehaviorCount(replyText: string): number | null {
  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };
  const m = replyText.match(
    /\b(one|two|three|four|five|\d+)\s+on the map\b/i,
  );
  if (!m) return null;
  const key = m[1].toLowerCase();
  if (key in wordToNumber) return wordToNumber[key];
  const n = Number(key);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

/**
 * Pulls an "I worry that if X, then Y" sentence out of a message. Used
 * by the worries backstop to recover a worry when the coach probed to
 * depth and acknowledged the fear in reply text but forgot to fire
 * propose_worry. Returns the extracted sentence WITH stem re-normalized,
 * or null if nothing recognizable.
 */
export function extractWorryDraft(text: string): string | null {
  const re =
    /\bI\s*[\u2019'\u02BC]?\s*worry\s+that\b([^.!?\n]{5,400}[.!?]?)/i;
  const m = text.match(re);
  if (!m) return null;
  const body = m[1].replace(/[.!?]+$/, "").trim();
  if (body.length === 0) return null;
  return `I worry that ${body}`;
}

/**
 * Pulls the quoted "I assume that if X, then Y" from an assistant
 * message. Delimiters are double-quotes only (straight " or curly
 * \u201C \u201D) — single quotes are excluded because apostrophes
 * inside I'm / don't would prematurely terminate the character class.
 * Returns the extracted text (caller reapplies the stem via ensureStem).
 */
export function extractAssumptionDraft(text: string): string | null {
  const re =
    /["\u201C]\s*(I\s*['\u2019\u02BC]?\s*assume\s+that\b[^"\u201C\u201D]{5,300}?)\s*["\u201D]/i;
  const m = text.match(re);
  if (!m) return null;
  const draft = m[1].replace(/[.!?]+$/, "").trim();
  return draft.length > 0 ? draft : null;
}

/**
 * Pulls numbered "I'm also committed to ..." drafts out of an assistant
 * message. Tolerant of smart-apostrophes and leading whitespace. Order
 * is preserved — the caller aligns index N to the Nth locked worry.
 */
export function extractCommitmentDrafts(text: string): string[] {
  const drafts: string[] = [];
  const re =
    /^\s*\d+[.)]\s+(I[\u2019'\u02BC]?m also committed to [^\n]+?)\s*$/i;
  for (const rawLine of text.split("\n")) {
    const m = rawLine.match(re);
    if (!m) continue;
    const draft = m[1]
      .replace(/^I[\u2019\u02BC]?m/i, "I'm")
      .replace(/[.!?]+$/, "")
      .trim();
    if (draft.length > 0) drafts.push(draft);
  }
  return drafts;
}
