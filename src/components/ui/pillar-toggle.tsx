"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { PillarCode } from "@/lib/pillars";
import { PILLAR_BY_CODE } from "@/lib/pillars";

/**
 * Large tap target for the daily check-in grid.
 * Value states: null (not logged), 0 (didn't do it), 1 (done).
 * Blank vs zero distinction preserved end to end.
 * `derived` renders the tile as read-only ("AUTO") — used for the Action pillar,
 * which is computed from mission execution, not a user toggle.
 */
export function PillarToggle({
  code,
  value,
  onChange,
  disabled,
  derived,
}: {
  code: PillarCode;
  value: 0 | 1 | null;
  onChange: (v: 0 | 1 | null) => void;
  disabled?: boolean;
  derived?: boolean;
}) {
  const p = PILLAR_BY_CODE[code];
  const isDone = value === 1;

  // Binary: done or not-done. Click toggles between them; anything other than 1
  // reads as "not done" (null and 0 both render the same). Server actions still
  // accept 0 for admin corrections and legacy data.
  const toggle = () => {
    if (disabled) return;
    onChange(isDone ? null : 1);
  };

  const label = derived
    ? isDone
      ? "mission done"
      : value === 0
        ? "mission set, not done"
        : "no mission today"
    : isDone
      ? "done"
      : "not done";

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileTap={derived ? undefined : { scale: 0.94 }}
      transition={{ type: "spring", stiffness: 500, damping: 24 }}
      aria-label={`${p.label} — ${label}${derived ? " (auto)" : ""}`}
      aria-pressed={isDone}
      className={cn(
        "relative h-24 w-full rounded-[var(--radius-card)] border flex flex-col items-center justify-center gap-1",
        "transition-colors font-heading text-sm",
        isDone
          ? "border-transparent text-white"
          : "border-[color:var(--color-border)] text-[color:var(--color-text-muted)] bg-[color:var(--color-surface)]",
        derived && "cursor-default",
      )}
      style={isDone ? { backgroundColor: p.colorVar } : undefined}
      disabled={disabled}
    >
      <span className="text-2xl leading-none">{p.code === "A2" ? "A" : p.code}</span>
      <span className="text-[10px] tracking-widest">{p.short.toUpperCase()}</span>
      {derived ? (
        <span className="absolute bottom-1 right-2 text-[8px] tracking-widest opacity-60">
          AUTO
        </span>
      ) : null}
    </motion.button>
  );
}
