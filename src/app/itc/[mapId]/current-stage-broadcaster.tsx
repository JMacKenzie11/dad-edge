"use client";

import { useEffect, useRef } from "react";
import { currentStageStore } from "@/lib/itc/current-stage-store";
import type { ItcStage } from "@/lib/itc/stage";

/**
 * Two jobs, both driven by the map's server-rendered current_stage:
 *
 *   1. Push the stage into the client store so `ItcStageNav` (up in
 *      the layout's left rail) can highlight the right step. Runs on
 *      every re-render, including post-advance revalidation.
 *
 *   2. Auto-scroll to the newly-active section when the stage
 *      transitions. Skipped on the initial mount (the coachee is
 *      landing on the page, might be resuming mid-flow — jumping
 *      them to a different position would feel wrong). Fires only
 *      when the stage prop CHANGES on a subsequent render (server
 *      revalidated after an advance).
 *
 * Section elements carry id="stage-section-{stage}" (see the `stage`
 * prop on `Section` in map-canvas.tsx) and `scroll-mt-24` so the
 * scroll lands the section title just below the sticky AppHeader.
 */
export function CurrentStageBroadcaster({
  mapId,
  stage,
}: {
  mapId: string;
  stage: ItcStage;
}) {
  const previousStageRef = useRef<ItcStage | null>(null);

  useEffect(() => {
    currentStageStore.set({ mapId, stage });

    const previous = previousStageRef.current;
    if (previous && previous !== stage) {
      // Wait one frame so the DOM has definitely committed the new
      // section (some sections mount for the first time on advance).
      requestAnimationFrame(() => {
        const target = document.getElementById(`stage-section-${stage}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
    previousStageRef.current = stage;

    return () => {
      const current = currentStageStore.get();
      if (current.mapId === mapId) currentStageStore.clear();
    };
  }, [mapId, stage]);

  return null;
}
