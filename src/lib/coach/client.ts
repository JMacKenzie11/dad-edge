import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * LLM registry. All coach calls go through the Vercel AI SDK so we can swap
 * providers (Anthropic ↔ OpenAI ↔ Google) without touching the coach code.
 *
 * §6 cost tiering — Sonnet for substantive coaching turns, Haiku for
 * classification / routing / short-form tasks (quality gate, safety filter,
 * nudge copy).
 *
 * Env: ANTHROPIC_API_KEY is picked up automatically by @ai-sdk/anthropic.
 */
export const MODELS = {
  coach: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
} as const;

export function coachModel(): LanguageModel {
  return anthropic(MODELS.coach);
}

export function haikuModel(): LanguageModel {
  return anthropic(MODELS.haiku);
}
