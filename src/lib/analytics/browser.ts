"use client";

import posthog from "posthog-js";
import type { AnalyticsEvent } from "./events";

/**
 * Browser-side PostHog wrapper. Init runs once via PostHogBridge in
 * the app layout. capture() calls no-op silently when the SDK never
 * initialized (missing env vars).
 *
 * Autocapture is DISABLED. This app has enough intentional events
 * that catching every click as a generic $click adds noise without
 * signal. Page views are still auto-tracked because they're the
 * default retention primitive.
 */

let initialized = false;

export function initPostHog(distinctId: string | null): void {
  if (typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) return;

  if (!initialized) {
    posthog.init(key, {
      api_host: host,
      // Manual clicks etc — no autocapture noise.
      autocapture: false,
      // IMPORTANT: false here. Next.js App Router does soft navigation
      // (no full page reload), so PostHog's default only-on-init
      // pageview capture misses everything after the first landing.
      // PostHogPageview component below fires $pageview manually on
      // every pathname / searchParams change instead.
      capture_pageview: false,
      // Session recording off for MVP. Enable later with a masking
      // policy if we need to debug specific UX issues.
      disable_session_recording: true,
      persistence: "localStorage+cookie",
      loaded: () => {
        if (distinctId) posthog.identify(distinctId);
      },
    });
    initialized = true;
  } else if (distinctId) {
    // Re-identify in case the user changed accounts in the same tab.
    posthog.identify(distinctId);
  }
}

export function captureBrowserEvent(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  try {
    posthog.capture(event.name, event.props as Record<string, unknown>);
  } catch (err) {
    console.warn(
      "[analytics] captureBrowserEvent %s failed: %s",
      event.name,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Fire a $pageview event. Called by PostHogPageview on every route
 * change (App Router doesn't trigger PostHog's built-in init-only
 * capture). Safe when uninitialized — no-op.
 */
export function capturePageview(url: string): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  try {
    posthog.capture("$pageview", { $current_url: url });
  } catch {
    // best-effort
  }
}

/**
 * Explicit reset on sign-out — clears the identified distinctId so
 * a subsequent sign-in as a different user starts a clean session.
 */
export function resetPostHog(): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  try {
    posthog.reset();
  } catch {
    // best-effort
  }
}
