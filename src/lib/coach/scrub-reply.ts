/**
 * Defensive scrubber for main-coach reply text. The prompt bans em-dashes
 * (docs/coach-voice-and-tone.md punctuation section) but no prompt rule
 * survives every generation; a scrubber at the output boundary guarantees
 * the coachee never sees one.
 *
 * Deliberately narrow — the punctuation strip is the one non-negotiable
 * that a coachee will visually catch and mark as AI. Deeper voice
 * violations (manufactured reversals, dramatic openers, etc.) are
 * prompt concerns, not scrubber concerns; a scrubber can't tell the
 * difference between an earned reversal and a manufactured one.
 */
export function scrubCoachReply(text: string): string {
  return text
    // Em dashes and en dashes → comma-space. Match ITC's scrubReply.
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    // Double hyphens as em-dash substitute → same treatment.
    .replace(/\s*--\s*/g, ", ")
    // Collapse any double-comma-space the substitution might produce.
    .replace(/,\s*,/g, ",")
    // Trim leading whitespace only; preserve trailing paragraph breaks.
    .replace(/^\s+/, "");
}
