import { PostHog } from "posthog-node";
import type { AnalyticsEvent } from "./events";

/**
 * Server-side PostHog wrapper.
 *
 * Design intent:
 *   - Silent no-op when env vars are missing. Local dev without
 *     NEXT_PUBLIC_POSTHOG_KEY should not crash or log noise every
 *     event.
 *   - Singleton client — posthog-node buffers events in memory and
 *     flushes on interval. One client per process, not per request.
 *   - Fire-and-forget: capture() returns void. Any network / config
 *     failure logs a warn and swallows. Analytics should never break
 *     a user request.
 *   - Uses users.id as the `distinctId`. NEVER email — GDPR + churn
 *     concerns. Same id the browser SDK identifies against, so
 *     server + client events unify on one user record.
 */

let cachedClient: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (cachedClient !== undefined) return cachedClient;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  if (!key || !host) {
    cachedClient = null;
    return null;
  }
  cachedClient = new PostHog(key, {
    host,
    // Flush aggressively so short-lived Vercel serverless invocations
    // don't lose events between invocations. Default flushAt is 20
    // events / 10s — too coarse for our per-request writes.
    flushAt: 1,
    flushInterval: 0,
  });
  return cachedClient;
}

/**
 * Fire an event on behalf of the given user. distinctId = users.id.
 * If analytics isn't configured (missing env vars), no-op silently.
 */
export function captureServerEvent(
  distinctId: string,
  event: AnalyticsEvent,
): void {
  try {
    const client = getClient();
    if (!client) return;
    client.capture({
      distinctId,
      event: event.name,
      properties: event.props,
    });
  } catch (err) {
    console.warn(
      "[analytics] captureServerEvent %s failed: %s",
      event.name,
      err instanceof Error ? err.message : String(err),
    );
  }
}
