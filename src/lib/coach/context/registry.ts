import type { ContextProvider } from "./types";
import { familyProvider } from "./providers/family";
import { goalsProvider } from "./providers/goals";
import { identityProvider } from "./providers/identity";
import { itcProvider } from "./providers/itc";
import { missionsProvider } from "./providers/missions";
import { reflectionsProvider } from "./providers/reflections";
import { streaksProvider } from "./providers/streaks";
import { surveyProvider } from "./providers/survey";

/**
 * Registered coach context providers. Order in this array doesn't
 * matter — the assembler sorts by (cacheable-bucket, priority).
 * Adding a new context source is exactly this: write the file,
 * append to this array. No other change needed anywhere.
 *
 * Cacheable providers (identity, family, survey) render into the
 * prompt's cacheable prefix; the rest render after and re-tokenize
 * on every turn.
 */
export const CONTEXT_PROVIDERS: ContextProvider[] = [
  identityProvider,
  familyProvider,
  streaksProvider,
  goalsProvider,
  missionsProvider,
  reflectionsProvider,
  itcProvider,
  surveyProvider,
];
