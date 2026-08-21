import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Voice + tone bundle for the MAIN COACH only (src/lib/coach/prompts.ts,
 * general and mission modes). NOT loaded by the ITC coach — that path
 * reads only the shared voice doc via src/lib/itc/prompts/preamble.ts,
 * and its output has been calibrated to a voice that's working.
 *
 * Composition:
 *   1. docs/coach-voice-and-tone.md  — shared voice/tone rules used
 *                                      by both coaches (contractions,
 *                                      no praise, banned vocabulary,
 *                                      no em-dashes, etc.)
 *   2. docs/main-coach-ai-patterns.md — stricter AI-pattern bans that
 *                                      only apply to the main coach's
 *                                      open conversational surface
 *                                      (manufactured reversals,
 *                                      dramatic openers, tricolons,
 *                                      empty intensifiers, etc.)
 *
 * The split exists specifically so tightening the main coach doesn't
 * change the ITC coach's behavior (product decision 2026-08-27).
 * Updating shared rules is one file (`coach-voice-and-tone.md`);
 * updating main-coach-only rules is another (`main-coach-ai-patterns.md`).
 */

function readDoc(filename: string): string {
  return readFileSync(join(process.cwd(), "docs", filename), "utf8").trim();
}

const SHARED_VOICE = readDoc("coach-voice-and-tone.md");
const MAIN_COACH_AI_PATTERNS = readDoc("main-coach-ai-patterns.md");

export const MAIN_COACH_VOICE = `${SHARED_VOICE}

===== ADDITIONAL RULES — MAIN COACH ONLY =====

${MAIN_COACH_AI_PATTERNS}`;

/**
 * Prepend the composed main-coach voice bundle to a system prompt, with
 * a clear delimiter so the model can distinguish rules from the surface-
 * specific prompt that follows.
 */
export function withVoiceRules(systemPrompt: string): string {
  return `${MAIN_COACH_VOICE}\n\n===== END VOICE RULES =====\n\n${systemPrompt}`;
}
