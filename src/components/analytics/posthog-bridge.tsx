"use client";

import { useEffect } from "react";
import { initPostHog } from "@/lib/analytics/browser";

/**
 * Boots PostHog on the client and identifies the current user.
 * Rendered once inside the app layout (server component passes the
 * viewer's user id in). If env vars aren't set, init silently no-ops
 * so local dev without a PostHog project stays quiet.
 */
export function PostHogBridge({ userId }: { userId: string | null }) {
  useEffect(() => {
    initPostHog(userId);
  }, [userId]);
  return null;
}
