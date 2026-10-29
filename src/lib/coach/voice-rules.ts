import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Voice bundle for the Coach Larry chat only (src/lib/coach/prompts.ts,
 * general and mission modes). The coach speaks as Larry Hagner
 * (DECISIONS.md "Coach Larry speaks as Larry").
 *
 * Composition:
 *   1. docs/larry-voice.md    — who he is, how a conversation goes, the
 *                               questions, how he sounds, the never list
 *   2. docs/larry-playbook.md — his facts, beliefs, tools, the only
 *                               stories he may tell, his scripts
 *
 * Not loaded anywhere else. The ITC coach, the weekly recap and mission
 * scoring keep docs/coach-voice-and-tone.md, so changing Larry's voice
 * changes nothing on those surfaces.
 */

function readDoc(filename: string): string {
  return readFileSync(join(process.cwd(), "docs", filename), "utf8").trim();
}

export const LARRY_VOICE = readDoc("larry-voice.md");
export const LARRY_PLAYBOOK = readDoc("larry-playbook.md");

export const MAIN_COACH_VOICE = `${LARRY_VOICE}

===== LARRY'S PLAYBOOK =====

${LARRY_PLAYBOOK}`;

/**
 * Prepend the Larry voice bundle to a system prompt, with a clear
 * delimiter so the model can tell the rules from the mode-specific
 * prompt that follows.
 */
export function withVoiceRules(systemPrompt: string): string {
  return `${MAIN_COACH_VOICE}\n\n===== END VOICE RULES =====\n\n${systemPrompt}`;
}
