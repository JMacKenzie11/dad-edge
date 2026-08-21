/**
 * Small helpers shared across providers. Kept here so the providers
 * stay focused on their own domain instead of duplicating rendering
 * primitives.
 */

/** Rough token estimate ~ characters / 4. Good enough for logging
 *  and budget decisions; not an exact tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Average of a number array. Zero for empty input. */
export function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
