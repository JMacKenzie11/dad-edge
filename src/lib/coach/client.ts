/**
 * LLM registry for the non-ITC (primary) coach. All calls go through the
 * Vercel AI SDK so we can swap providers without touching the coach code.
 *
 * Model IDs are ENV-ONLY — no hardcoded fallbacks. When a model is
 * deprecated we want a loud failure, not a silent switch to a stale
 * default. See src/lib/model-config.ts for the shared helper.
 *
 * Env vars used (both required):
 *   - PRIMARY_COACH_MODEL (Sonnet-class recommended)
 *   - PRIMARY_HAIKU_MODEL (Haiku-class recommended)
 * Env: ANTHROPIC_API_KEY is picked up automatically by @ai-sdk/anthropic.
 */

export {
  primaryCoachModel as coachModel,
  primaryHaikuModel as haikuModel,
} from "@/lib/model-config";
