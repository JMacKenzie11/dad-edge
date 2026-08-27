"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import {
  STAGE_LABELS,
  stageIndex,
  type ItcStage,
} from "@/lib/itc/stage";
import { currentStageStore } from "@/lib/itc/current-stage-store";
import { ResetMapButton } from "./[mapId]/reset-map-button";

/**
 * Left-rail nav shown on /itc/[mapId] in place of the main-app SideNav.
 *
 * Reads the current stage from `currentStageStore`, which is pushed by
 * the `CurrentStageBroadcaster` rendered on the map page. This means
 * every server re-render of the map page (including post-advance
 * revalidation) automatically flows through to the nav highlight
 * without a client-side re-fetch.
 *
 * Rendering behavior:
 *   - CURRENT stage: strongly highlighted — accent color, filled surface
 *     background, left accent bar, bold weight. Impossible to miss.
 *   - COMPLETED stages: dimmed with a success-color checkmark.
 *   - LOCKED stages: dimmer still, hollow-circle indicator, rendered as
 *     inert spans (no link) so a coachee can't click ahead. The stage
 *     machine only lets you advance one step at a time via the coach's
 *     flow — clicking a future step here would be a false affordance.
 *
 * "review" is deliberately excluded (assumptions → immune_system
 * skips it per canTransitionTo). "done" also omitted (terminal state).
 */
const NAV_STAGES: ItcStage[] = [
  "goal",
  "behaviors",
  "worries",
  "commitments",
  "assumptions",
  "immune_system",
  "prioritize",
  "test_design",
  "test_running",
  "results",
];

export function ItcStageNav({
  mapId,
  isPlatformAdmin,
}: {
  mapId: string;
  isPlatformAdmin: boolean;
}) {
  const state = useSyncExternalStore(
    currentStageStore.subscribe,
    () => currentStageStore.get(),
    // Server snapshot — matches the initial client snapshot to avoid
    // hydration mismatch. On the very first render (before the map
    // page's broadcaster has fired its useEffect) we render every
    // stage as locked; the broadcaster fires immediately after and
    // the nav re-renders with the correct highlight.
    () => ({ mapId: null, stage: null }),
  );

  // Only trust the store if it's talking about the same map. If the
  // coachee just navigated to a different map (rare — one active map
  // per participant — but possible during history browsing) we don't
  // want to leak stage from the previous one.
  const current = state.mapId === mapId ? state.stage : null;
  const currentIdx = current ? stageIndex(current) : -1;

  return (
    <nav className="hidden md:flex flex-col gap-1 p-4">
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2 px-3">
        IMPROVEMENT MAP
      </p>
      {NAV_STAGES.map((stage) => {
        const idx = stageIndex(stage);
        const state: "done" | "active" | "locked" =
          currentIdx < 0
            ? "locked"
            : idx < currentIdx
              ? "done"
              : idx === currentIdx
                ? "active"
                : "locked";
        return <StageRow key={stage} label={STAGE_LABELS[stage]} state={state} />;
      })}

      {/* Utility items styled to match StageRow so the rail reads
          as one continuous list. Clear map sits directly after
          RESULTS (no divider); Admin follows for platform admins. */}
      <ResetMapButton mapId={mapId} />
      {isPlatformAdmin ? (
        <Link
          href="/itc/admin"
          className="flex items-center gap-3 h-11 px-3 rounded-md font-heading text-sm tracking-wide text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-surface)] hover:text-white"
        >
          <span className="text-base">⚙</span>
          <span className="flex-1">ADMIN</span>
        </Link>
      ) : null}
    </nav>
  );
}

function StageRow({
  label,
  state,
}: {
  label: string;
  state: "done" | "active" | "locked";
}) {
  if (state === "active") {
    return (
      <div
        aria-current="step"
        // 4-way emphasis so the current step is unmistakable:
        //  - filled surface bg
        //  - accent-color text
        //  - left accent bar (2px)
        //  - bold heading weight
        className="flex items-center gap-3 h-11 pl-2.5 pr-3 rounded-md font-heading text-sm tracking-wide bg-[color:var(--color-surface)] text-[color:var(--color-accent)] border-l-2 border-[color:var(--color-accent)]"
      >
        <span className="text-base">●</span>
        <span className="flex-1">{label}</span>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="flex items-center gap-3 h-11 px-3 rounded-md font-heading text-sm tracking-wide text-[color:var(--color-text-muted)]">
        <span className="text-base text-[color:var(--color-success)]">✓</span>
        <span className="flex-1">{label}</span>
      </div>
    );
  }
  return (
    <div
      aria-disabled
      className="flex items-center gap-3 h-11 px-3 rounded-md font-heading text-sm tracking-wide text-[color:var(--color-text-muted)]/40"
    >
      <span className="text-base">○</span>
      <span className="flex-1">{label}</span>
    </div>
  );
}
