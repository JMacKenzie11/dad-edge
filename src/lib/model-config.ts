import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * All Anthropic model IDs used by the app come from environment variables.
 * We deliberately do NOT ship hardcoded fallbacks: when a model is
 * deprecated, we want a loud, unambiguous failure at first use ("env var
 * X is required, set it to a currently-valid Anthropic model id"), not
 * a silent switch to a stale default that quietly returns errors from
 * the API and gets misdiagnosed as an app bug.
 *
 * Naming convention: every env var is ITC_<ROLE>_MODEL. Add a new role
 * by defining a getter here, not by inlining process.env access in the
 * caller.
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
 * The main conversational coach that drives the ITC map. High-quality
 * model recommended (Sonnet class).
 */
export function coachModel(): LanguageModel {
  return anthropic(requireEnv("ITC_COACH_MODEL", "main ITC coach model"));
}

export function coachModelId(): string {
  return requireEnv("ITC_COACH_MODEL", "main ITC coach model");
}

/**
 * The depth/self-protection rubrics run against worries, commitments,
 * and Big Assumptions. Fast, cheap model is fine (Haiku class) since
 * outputs are structured scores.
 */
export function rubricModel(): LanguageModel {
  return anthropic(
    requireEnv("ITC_RUBRIC_MODEL", "worry/commitment/assumption depth rubric"),
  );
}

/**
 * The post-turn reconciliation pass. Fast model (Haiku class) — runs on
 * every coach turn and catches state changes the coach's reply implied
 * but didn't fire as an action.
 */
export function reconcileModel(): LanguageModel {
  return anthropic(
    requireEnv("ITC_RECONCILE_MODEL", "post-turn reconciliation model"),
  );
}

/**
 * The LLM judge used by scenario tests to grade coach replies against
 * qualitative rubrics (no dangling promises, no unearned praise, etc.).
 * Only used in the test suite, not in the running app.
 */
export function judgeModel(): LanguageModel {
  return anthropic(
    requireEnv("ITC_TEST_JUDGE_MODEL", "scenario-test LLM judge"),
  );
}

/**
 * Alternate "main coach" used by the non-ITC coach client
 * (src/lib/coach/client.ts).
 */
export function primaryCoachModel(): LanguageModel {
  return anthropic(
    requireEnv("PRIMARY_COACH_MODEL", "primary (non-ITC) coach model"),
  );
}

/**
 * Alternate "utility" (small/fast) model used by the non-ITC coach
 * client for lower-quality follow-up tasks.
 */
export function primaryHaikuModel(): LanguageModel {
  return anthropic(
    requireEnv(
      "PRIMARY_HAIKU_MODEL",
      "primary (non-ITC) coach small/utility model",
    ),
  );
}
