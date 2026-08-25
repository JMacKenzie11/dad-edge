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
      // Manual events only. Page views stay auto ($pageview) because
      // that's PostHog's core retention primitive.
      autocapture: false,
      capture_pageview: true,
      // Session recording off for MVP. Enable later with a masking
      // policy if we need to debug specific UX issues.
      disable_session_recording: true,
      // Server-side rendering: skip cookies during SSR (posthog-js
      // handles this itself if window is defined, but be explicit).
      persistence: "localStorage+cookie",
      // Only send default $set person props (browser, os, etc).
      // Don't auto-attach user-agent-detected geo — PostHog does
      // that server-side from the request IP if we want it.
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
