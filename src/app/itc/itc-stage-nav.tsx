"use client";

import { useEffect, useState } from "react";
import {
  STAGE_LABELS,
  stageIndex,
  type ItcStage,
} from "@/lib/itc/stage";

/**
 * Left-rail nav shown on /itc/[mapId] in place of the main-app SideNav.
 *
 * Renders the 10 canonical stages the coachee moves through. Behavior:
 *   - CURRENT stage: strongly highlighted — accent color, filled surface
 *     background, left accent bar, bold weight. Impossible to miss.
 *   - COMPLETED stages: dimmed but visible, with a checkmark. Rendered
 *     as inert spans (no link) because there's nothing to "navigate"
 *     to — the full canvas is on one page and completed sections stay
 *     rendered above the current one.
 *   - LOCKED stages: dimmer still, small "•" indicator. Also inert.
 *     Prevents the coachee from clicking ahead and rewriting the map
 *     out of order; the stage machine only lets you advance one step
 *     at a time (via the coach's flow, not by clicking).
 *
 * "review" is deliberately excluded — assumptions → immune_system
 * skips it per canTransitionTo(), matching the existing StageProgress
 * component's HEADER_STAGES list. "done" also omitted (terminal
 * state, not a step to reach for).
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

export function ItcStageNav({ mapId }: { mapId: string }) {
  const [current, setCurrent] = useState<ItcStage | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/itc/maps/${mapId}/current-stage`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stage?: ItcStage } | null) => {
        if (!cancelled && d?.stage) setCurrent(d.stage);
      })
      .catch(() => {
        /* Non-fatal — the nav renders in a neutral "not yet loaded"
           state until the fetch resolves. */
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

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
        //  - filled surface bg (matches SideNav active)
        //  - accent-color text
        //  - left accent bar (2px)
        //  - bold weight from font-heading + text-sm
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
  // Locked — future stage, not yet reachable.
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
