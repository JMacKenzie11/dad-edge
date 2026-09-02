"use client";

import { depthSeverity } from "@/lib/itc/criteria/types";

/**
 * One badge for every column, driven by the severity the rubric
 * already computed. Before this, all four rows painted the same red
 * pill at any score below 3, which put a 2/3 entry the guides would
 * accept in the same visual class as a strategy note that isn't a
 * map entry at all.
 *
 * The distinction is not new — `depthSeverity` has always separated
 * critical (0-1) from moderate (2), and `worryPassesDepth` already
 * clears a 2 on the second attempt. The badge was throwing that
 * judgment away at the last inch. It now reads it:
 *
 *   0-1  critical  "Needs more depth"  danger
 *   2    moderate  "One more pass"     warning
 *
 * Kegan & Lahey Vol 1 p 19 is explicit that a Big Assumption doesn't
 * arrive finished: "You don't need to have the exact assumption yet,
 * because that is likely to get sharpened through his engaging it."
 * A 2 is that sharpening in progress, and it should look like it.
 *
 * Class strings are written out in full on both branches. Tailwind
 * scans source text, so a class assembled by interpolation compiles
 * to nothing.
 */
const CRITICAL_PILL =
  "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest shrink-0 border-[color:var(--color-danger)]/60 bg-[color:var(--color-danger)]/[0.10] text-[color:var(--color-danger)]";
const MODERATE_PILL =
  "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest shrink-0 border-[color:var(--color-warning)]/60 bg-[color:var(--color-warning)]/[0.10] text-[color:var(--color-warning)]";

export function DepthBadge({
  score,
  column,
  className = "",
}: {
  score: number | null;
  column: "behavior" | "worry" | "commitment" | "assumption";
  className?: string;
}) {
  if (score === null) return null;
  const critical = depthSeverity(score) === "critical";
  return (
    <span
      className={(className ? className + " " : "") + (critical ? CRITICAL_PILL : MODERATE_PILL)}
      title={
        critical
          ? `This ${column} hasn't reached the depth needed to advance. Sharpen it to clear the gate.`
          : `This ${column} is close. Take one more pass at it, or save it again as is and it clears the gate.`
      }
    >
      {critical ? "Needs more depth" : "One more pass"}
    </span>
  );
}

/** Border tone for a row carrying an unresolved depth shortfall. */
export function depthBorderClass(score: number | null): string {
  if (score === null) return "border-[color:var(--color-border)] ";
  return depthSeverity(score) === "critical"
    ? "border-[color:var(--color-danger)]/50 "
    : "border-[color:var(--color-warning)]/50 ";
}
