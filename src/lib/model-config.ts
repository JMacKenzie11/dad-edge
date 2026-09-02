import { anthropic } from "@ai-sdk/anthropic";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

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

/**
 * Floor on every structured-output call's token budget.
 *
 * A reasoning model spends output tokens thinking BEFORE it emits the
 * object. When the budget is sized for the object alone, the thinking
 * consumes it and the call returns nothing: "No object generated: the
 * model did not return a response". Observed in production 2026-09-02
 * on claude-sonnet-5, where nine of ten worry drafts came back empty
 * and the depth rubric failed the same way at its 512-token budget.
 * Locally the same code was fine, because local ran a Haiku-class
 * model that doesn't think first.
 *
 * Enforced as a floor in middleware rather than by editing 29 call
 * sites: the number at each call site states the INTENT (how long the
 * answer should be), and this guarantees the INVARIANT (the model has
 * room to reach it) for every call, including ones written later.
 *
 * Raising a ceiling is free. Output tokens are billed as generated,
 * not as budgeted, so headroom costs nothing when it goes unused. The
 * schema is what actually bounds the answer's length.
 */
export const MIN_OUTPUT_TOKEN_BUDGET = 4000;

/**
 * Extended thinking off, token floor on. One middleware, every call.
 *
 * Measured on claude-sonnet-5 with the worry drafter's real system
 * prompt (2026-09-02):
 *
 *   thinking on (default):   25.4s, 2132 output tokens
 *   thinking off:             2.3s,   53 output tokens
 *
 * The object itself is ~60 tokens. Everything else was deliberation,
 * and it caused both symptoms we saw in production: budgets sized for
 * the answer were consumed before the model reached it, so calls came
 * back empty ("No object generated"), and the ones that survived took
 * 40-80 seconds while a man watched a spinner.
 *
 * Turning it off is not a quality trade here, it is this app's whole
 * design: quality is enforced AFTER generation by the depth rubrics
 * and the criteria module, which re-score every draft and reject what
 * fails. Deliberation inside an opaque call is exactly the kind of
 * unverifiable judgment the architecture replaced with checks. It is
 * also the configuration every prompt in this codebase was written
 * and tuned against (a Haiku-class model, which does not think first).
 *
 * If a future surface genuinely needs deliberation, give it its own
 * model accessor rather than turning this back on globally, and
 * re-tune its prompts against the thinking model.
 */
const structuredCallDefaults: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    maxOutputTokens: Math.max(
      params.maxOutputTokens ?? 0,
      MIN_OUTPUT_TOKEN_BUDGET,
    ),
    providerOptions: {
      ...params.providerOptions,
      anthropic: {
        ...params.providerOptions?.anthropic,
        thinking: { type: "disabled" },
      },
    },
  }),
};

function withStructuredCallDefaults(model: LanguageModel): LanguageModel {
  return typeof model === "string"
    ? model
    : wrapLanguageModel({ model, middleware: structuredCallDefaults });
}

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
  // Overrides are test seams (record/replay, hard-fail stubs) and are
  // returned untouched so tests see exactly the model they installed.
  if (mainModelOverride) return mainModelOverride;
  return withStructuredCallDefaults(
    anthropic(requireEnv("ANTHROPIC_MODEL", "main conversational coach model")),
  );
}

/** Fast/cheap tier — rubrics, reconciliation, judge, safety classifier. */
export function utilityModel(): LanguageModel {
  if (utilityModelOverride) return utilityModelOverride;
  return withStructuredCallDefaults(
    anthropic(
      requireEnv(
        "ANTHROPIC_UTILITY_MODEL",
        "fast utility model (rubrics, reconciliation, judge, safety classifier)",
      ),
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
