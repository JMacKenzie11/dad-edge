"use client";

import { useEffect } from "react";
import { currentStageStore } from "@/lib/itc/current-stage-store";
import type { ItcStage } from "@/lib/itc/stage";

/**
 * Push the map's server-rendered current stage into the client store
 * so ItcStageNav (in the layout's left rail) can highlight the right
 * step. Rendered from the map page; re-runs on every server re-render
 * (including post-advance revalidation), so the nav updates for free
 * as the coachee moves through the flow.
 */
export function CurrentStageBroadcaster({
  mapId,
  stage,
}: {
  mapId: string;
  stage: ItcStage;
}) {
  useEffect(() => {
    currentStageStore.set({ mapId, stage });
    // On unmount (coachee navigates away from the map) clear the
    // store so the nav on other ITC pages doesn't render stale
    // highlights against an unrelated route.
    return () => {
      const current = currentStageStore.get();
      if (current.mapId === mapId) currentStageStore.clear();
    };
  }, [mapId, stage]);
  return null;
}
