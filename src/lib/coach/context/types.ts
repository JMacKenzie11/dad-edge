import type { SessionUser } from "@/lib/session";

/**
 * A ContextProvider builds one section of the coach's system-prompt
 * context. Each provider is independent — it fetches its own data,
 * renders its own text, and returns null when it has nothing to say
 * (a man with no kids, no survey, no ITC activity). The assembler
 * runs all registered providers in parallel and drops nulls silently.
 *
 * Adding a new context source is: write one file that implements this
 * interface, add it to the registry array. No changes to the
 * assembler, no changes to any prompt, no changes to any other
 * provider. That's the whole point of the pattern.
 *
 * `cacheable` marks slow-changing blocks (identity, family, survey)
 * that Anthropic prompt caching should hold across turns. Blocks
 * that change daily (missions, streaks, reflections) leave it false.
 * The assembler orders cacheable blocks before non-cacheable so the
 * cache prefix stays stable across a conversation.
 */
export interface ContextProvider {
  /** Stable identifier written to coach_messages.metadata for audit. */
  key: string;
  /** Lower runs first when both cacheable-buckets. Used to keep the
   *  rendered prompt in a predictable order across turns. */
  priority: number;
  /** True for slow-changing blocks; assembler emits these in the
   *  cacheable prefix of the system prompt. */
  cacheable: boolean;
  /** Return null when the provider has nothing (empty family, no
   *  survey, etc.) — assembler drops nulls, no empty sections. */
  build(user: SessionUser): Promise<ContextBlock | null>;
}

export interface ContextBlock {
  /** Section header for the assembled prompt, e.g. "The man",
   *  "Quarterly goals", "Missions". */
  label: string;
  /** Rendered body, ready to insert under the label. */
  text: string;
  /** Rough token count (~ chars / 4). Summed by the assembler and
   *  logged to coach_messages.metadata. */
  tokenEstimate: number;
}

export interface AssembledContext {
  /** Full prompt string with a leading "# Live user context" header
   *  and each provider's block rendered as "## {label}\n{text}". */
  systemContextText: string;
  /** Cacheable prefix — everything from providers with cacheable=true.
   *  send-message.ts marks this prefix with cache_control:ephemeral
   *  when calling Anthropic so the identity/family/survey load
   *  amortizes across a conversation. */
  cacheablePrefix: string;
  /** Non-cacheable body — everything that changes turn to turn
   *  (missions, streaks, reflections). Appended after the cacheable
   *  prefix in the final system prompt. */
  volatileBody: string;
  /** Provider keys that contributed a non-null block, in the order
   *  they were rendered. Written to coach_messages.metadata.context.providers. */
  providerKeys: string[];
  /** Sum of all block tokenEstimates. Written to
   *  coach_messages.metadata.context.tokenEstimate. */
  tokenEstimate: number;
}
