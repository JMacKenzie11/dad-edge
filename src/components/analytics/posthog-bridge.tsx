"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { capturePageview, initPostHog } from "@/lib/analytics/browser";

/**
 * Boots PostHog on the client, identifies the current user, and
 * emits $pageview on every App Router navigation (soft nav doesn't
 * trigger PostHog's built-in init-only capture — that's why
 * clicking between /today and /coach without a hard reload was
 * missing from the dashboard).
 *
 * Rendered once inside the app layout.
 */
export function PostHogBridge({ userId }: { userId: string | null }) {
  useEffect(() => {
    initPostHog(userId);
  }, [userId]);
  return (
    // useSearchParams triggers a CSR bailout when used outside
    // Suspense — wrap the pageview tracker so the rest of the app
    // isn't forced into client-only rendering.
    <Suspense fallback={null}>
      <PageviewTracker />
    </Suspense>
  );
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!pathname) return;
    let url = window.location.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    capturePageview(url);
  }, [pathname, searchParams]);
  return null;
}
