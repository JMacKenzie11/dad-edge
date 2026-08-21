import type { SessionUser } from "@/lib/session";
import { CONTEXT_PROVIDERS } from "./registry";
import type {
  AssembledContext,
  ContextBlock,
  ContextProvider,
} from "./types";

/**
 * Assemble the coach's system-prompt context from all registered
 * providers. Runs every provider's build() in parallel, drops nulls,
 * sorts (cacheable first, then by priority within each bucket), and
 * emits three strings:
 *
 *   - systemContextText: full body with "# Live user context" header
 *     and "## {label}" per block. What the AI SDK's `system:` param
 *     receives after prepending the persona/method prompt.
 *   - cacheablePrefix: rendered blocks from cacheable providers only.
 *     send-message.ts wraps this in Anthropic prompt caching so the
 *     identity/family/survey load amortizes across a conversation.
 *   - volatileBody: rendered blocks from non-cacheable providers.
 *     Re-tokenized every turn.
 *
 * Plus provider keys + total token estimate for coach_messages.metadata
 * logging (the "what did the coach know when it said that" audit trail).
 *
 * Tests can pass a custom provider list to prove the extensibility
 * pattern (a throwaway provider appears in the output with zero
 * changes to this file). Production callers use the default registry.
 */
export async function buildCoachContext(
  user: SessionUser,
  overrides?: ContextProvider[],
): Promise<AssembledContext> {
  const providers = overrides ?? CONTEXT_PROVIDERS;

  const built = await Promise.all(
    providers.map(async (p) => {
      try {
        const block = await p.build(user);
        return block ? { provider: p, block } : null;
      } catch (err) {
        console.warn(
          "[coach context] provider %s failed: %s",
          p.key,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }
    }),
  );

  const nonNull = built.filter(
    (x): x is { provider: ContextProvider; block: ContextBlock } => x !== null,
  );

  const cacheableFirst = nonNull
    .filter((x) => x.provider.cacheable)
    .sort((a, b) => a.provider.priority - b.provider.priority);
  const volatile = nonNull
    .filter((x) => !x.provider.cacheable)
    .sort((a, b) => a.provider.priority - b.provider.priority);

  const renderBlock = ({ block }: { block: ContextBlock }): string =>
    `## ${block.label}\n${block.text}`;

  const cacheablePrefix = cacheableFirst.length
    ? `# Live user context (stable)\n\n${cacheableFirst.map(renderBlock).join("\n\n")}`
    : "";
  const volatileBody = volatile.length
    ? `# Live user context (this turn)\n\n${volatile.map(renderBlock).join("\n\n")}`
    : "";

  const systemContextText = [cacheablePrefix, volatileBody]
    .filter((s) => s.length > 0)
    .join("\n\n");

  const providerKeys = [...cacheableFirst, ...volatile].map((x) => x.provider.key);
  const tokenEstimate = [...cacheableFirst, ...volatile].reduce(
    (sum, x) => sum + x.block.tokenEstimate,
    0,
  );

  return {
    systemContextText,
    cacheablePrefix,
    volatileBody,
    providerKeys,
    tokenEstimate,
  };
}
