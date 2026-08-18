import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Model IDs come from environment variables ONLY. We deliberately do
 * NOT ship hardcoded fallbacks: when a model is deprecated, we want a
 * loud, unambiguous failure at first use ("env var X is required, set
 * it to a currently-valid Anthropic model id"), not a silent switch to
 * a stale default that quietly returns errors from the API and gets
 * misdiagnosed as an app bug.
 *
 * Two env vars, two roles:
 *   - ANTHROPIC_MODEL         → conversational coach (main quality tier)
 *   - ANTHROPIC_UTILITY_MODEL → rubrics, reconciliation, judge,
 *                               safety classifier (fast/cheap tier)
 *
 * If you want to run everything on the same model, set both to the
 * same id. If you want to save cost, set utility to a Haiku-class
 * model. Add a third role only when there's a real reason to fork —
 * every new env var is another place model deprecation can bite.
 */

function requireEnv(name: string, description: string): string {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      `Missing required env var ${name} (${description}). Set it to a currently-valid Anthropic model id — no hardcoded fallback exists on purpose so model deprecations surface loudly. See .env.local.example.`,
    );
  }
  return raw.trim();
}

/**
 * Test seam: the persona harness in tests/itc-sessions installs
 * record/replay wrappers here so all LLM calls during a persona run
 * go through its middleware. Production code never touches these.
 * Reset to null after each test via afterEach.
 */
let mainModelOverride: LanguageModel | null = null;
let utilityModelOverride: LanguageModel | null = null;

export function setMainModelOverride(m: LanguageModel | null): void {
  mainModelOverride = m;
}
export function setUtilityModelOverride(m: LanguageModel | null): void {
  utilityModelOverride = m;
}

/** Main conversational tier — coach turns, non-ITC coach send-message. */
export function mainModel(): LanguageModel {
  if (mainModelOverride) return mainModelOverride;
  return anthropic(
    requireEnv("ANTHROPIC_MODEL", "main conversational coach model"),
  );
}

/** Fast/cheap tier — rubrics, reconciliation, judge, safety classifier. */
export function utilityModel(): LanguageModel {
  if (utilityModelOverride) return utilityModelOverride;
  return anthropic(
    requireEnv(
      "ANTHROPIC_UTILITY_MODEL",
      "fast utility model (rubrics, reconciliation, judge, safety classifier)",
    ),
  );
}

/** For log lines that want to name the model without failing on missing env. */
export function mainModelIdOrUnset(): string {
  return process.env.ANTHROPIC_MODEL?.trim() ?? "(unset)";
}

export function utilityModelIdOrUnset(): string {
  return process.env.ANTHROPIC_UTILITY_MODEL?.trim() ?? "(unset)";
}
