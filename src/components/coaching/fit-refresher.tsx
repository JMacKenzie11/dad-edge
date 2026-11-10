"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkFitsFor } from "@/lib/coaching/actions";

/**
 * Runs the fit check on this man's goal-linked missions that haven't been
 * judged yet (new, edited, or moved to another goal), then reloads the
 * page so the labels show. The nightly job covers everyone else.
 */
export function FitRefresher({ communityId, memberId, pending }: { communityId: string; memberId: string; pending: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "checking" | "failed">(pending > 0 ? "checking" : "idle");
  const started = useRef(false);

  useEffect(() => {
    if (pending === 0 || started.current) return;
    started.current = true;
    checkFitsFor({ communityId, memberId })
      .then((r) => {
        if ((r.judged ?? 0) > 0) router.refresh();
        setState(r.ok ? "idle" : "failed");
      })
      .catch(() => setState("failed"));
  }, [communityId, memberId, pending, router]);

  if (state === "checking") return <span className="text-xs text-[color:var(--color-text-muted)]">Checking how missions fit his goals…</span>;
  if (state === "failed") return <span className="text-xs text-[color:var(--color-text-muted)]">Fit check unavailable right now.</span>;
  return null;
}
