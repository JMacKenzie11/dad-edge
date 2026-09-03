"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { format } from "date-fns";
import {
  createMission,
  updateMission,
  deleteMission,
  completeMission,
  carryMissionToNextWeek,
} from "./actions";
import type { WeekMission } from "./page";
import type { MissionScore } from "@/lib/coach/mission-quality";
import { useConfirm } from "@/components/ui/use-confirm";

const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

// Fixed pixel widths so header, empty, and filled rows line up in every
// state (with or without coach pill, with or without action buttons,
// completed with just a "TUE" span vs. editable with a full day picker).
// Kept in sync with the column-header widths in weekly-planner.tsx.
// Column widths apply from `sm` up only. Below that the row stacks:
// the three fixed columns total 436px, which does not fit a 390px
// phone, so the mission text was being squeezed to one word per line
// while the actions ran off the right edge entirely.
//
// On mobile each column sizes to its content and the group wraps
// under the title. From `sm` the fixed widths return and the row is
// exactly as it was, which is what keeps the columns aligned with
// the header in weekly-planner.tsx.
const COL_DAY_WIDTH = "sm:w-[152px]"; // 7 buttons × 20px + 6 gaps × 2px
const COL_COACH_WIDTH = "sm:w-[92px]"; // fits "SHARPEN 10/10"
// Actions column = fixed sub-slots so each button holds its x-position
// even when siblings are hidden (e.g. COMPLETE + × are gone on completed
// rows — without fixed slots, → NEXT WEEK would slide right).
const COL_ACTIONS_WIDTH = "sm:w-[192px]"; // COMPLETE(68) + NEXT WEEK(92) + ×(24) + 2×gap(4)
const COL_COMPLETE_SLOT = "w-[68px]";
const COL_NEXT_WEEK_SLOT = "sm:w-[92px]";
const COL_DELETE_SLOT = "w-[24px]";

/**
 * Grow the textarea's height to fit its content whenever it changes.
 * Prevents mission text from getting clipped on long descriptions
 * without needing a fixed rows count.
 */
function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

type SlotProps = {
  mission: WeekMission | null;
  weekDates: string[];
  slotIndex: number;
  communityId: string | null;
  goalId: string | null;
  goalDescription: string | null;
  pillarCode: PillarCode;
  /** True when this mission already has a carry-forward child in next
   *  week's data. Disables → NEXT WEEK so guys don't spawn duplicates. */
  carriedForward: boolean;
  readOnly: boolean;
};

export function MissionSlot(props: SlotProps) {
  return props.mission ? <FilledSlot {...props} mission={props.mission} /> : <EmptySlot {...props} />;
}

function EmptySlot({
  weekDates,
  slotIndex,
  communityId,
  goalId,
  goalDescription,
  pillarCode,
  readOnly,
}: SlotProps) {
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [dayIndexes, setDayIndexes] = useState<number[]>(() => [
    defaultDayIndex(weekDates),
  ]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<MissionScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scoreSeq = useRef(0);
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useAutoResize(inputRef, description);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    if (description.trim().length < 3) {
      setScore(null);
      setScoring(false);
      return;
    }
    setScoring(true);
    scoreTimer.current = setTimeout(async () => {
      const seq = ++scoreSeq.current;
      try {
        const res = await fetch("/api/missions/quality", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            description,
            pillar_code: pillarCode,
            target_date: weekDates[dayIndexes[dayIndexes.length - 1]],
            goal_description: goalDescription,
          }),
        });
        if (seq !== scoreSeq.current) return;
        if (!res.ok) setScore(null);
        else setScore((await res.json()) as MissionScore);
      } finally {
        if (seq === scoreSeq.current) setScoring(false);
      }
    }, 800);
    return () => {
      if (scoreTimer.current) clearTimeout(scoreTimer.current);
    };
  }, [description, dayIndexes, weekDates, pillarCode, goalDescription]);

  if (readOnly) {
    return (
      <li className="px-4 py-3 text-[11px] text-[color:var(--color-text-muted)] bg-[color:var(--color-bg)]">
        Read-only account.
      </li>
    );
  }

  if (!expanded) {
    return (
      <li className="bg-[color:var(--color-bg)]">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full text-left px-4 py-3 text-[11px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
          aria-label={`Add mission to slot ${slotIndex + 1}`}
        >
          + ADD MISSION
        </button>
      </li>
    );
  }

  const save = () => {
    if (!communityId) {
      setError("Join a community first.");
      return;
    }
    const targetDates = dayIndexes.map((i) => weekDates[i]);
    setError(null);
    startTransition(async () => {
      const res = await createMission({
        community_id: communityId,
        pillar_code: pillarCode,
        description: description.trim(),
        target_dates: targetDates,
        quarterly_goal_id: goalId,
      });
      if (!res.ok) {
        setError(res.error);
      }
    });
  };

  const canSave = description.trim().length >= 8;

  const pillText = score ? `${score.total}/10` : scoring ? "…" : null;
  const pillColor = score
    ? score.ready
      ? "var(--color-primary)"
      : score.total >= 6
        ? "var(--color-warning)"
        : "var(--color-danger)"
    : "var(--color-text-muted)";

  return (
    <li className="bg-[color:var(--color-bg)] px-4 py-3 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <textarea
          ref={inputRef}
          rows={1}
          maxLength={280}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (canSave) save();
            else if (description.trim().length === 0) setExpanded(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSave) save();
              return;
            }
            if (e.key === "Escape") {
              setExpanded(false);
              setDescription("");
            }
          }}
          placeholder="Behavior + how you'll know it's done."
          className="w-full min-w-0 sm:flex-1 p-2 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm focus:border-[color:var(--color-primary)] resize-none overflow-hidden"
        />
        {/* Same stacking as the filled row: controls group under
            the input on a phone, dissolve back into columns at sm. */}
        <div className="flex flex-wrap items-center gap-3 sm:contents">
        <div className={`shrink-0 flex items-center justify-center ${COL_DAY_WIDTH}`}>
          <DayPicker
            weekDates={weekDates}
            value={dayIndexes}
            onChange={setDayIndexes}
          />
        </div>
        <div className={`shrink-0 flex items-center justify-center ${COL_COACH_WIDTH}`}>
          {pillText ? (
            <button
              type="button"
              onClick={() => setShowFeedback((v) => !v)}
              className="h-6 px-2 rounded border text-[9px] font-heading tracking-widest disabled:opacity-40"
              style={{ color: pillColor, borderColor: pillColor }}
              aria-label={`Coach quality score: ${pillText}. Click for details.`}
              title="Coach's take on this mission. Doesn't block saving."
              disabled={!score && !scoring}
            >
              {pillText}
            </button>
          ) : null}
        </div>
        <div className={`shrink-0 ${COL_ACTIONS_WIDTH}`} aria-hidden="true" />
        </div>
      </div>
      {error ? <p className="text-[11px] text-[color:var(--color-danger)]">{error}</p> : null}
      {pending ? (
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          SAVING…
        </p>
      ) : null}
      {showFeedback && score ? (
        <FeedbackPanel
          score={score}
          onDismiss={() => setShowFeedback(false)}
        />
      ) : null}
    </li>
  );
}

function FilledSlot({
  mission,
  weekDates,
  goalDescription,
  carriedForward,
  readOnly,
}: SlotProps & { mission: WeekMission }) {
  const [description, setDescription] = useState(mission.description);
  const [dayIndexes, setDayIndexes] = useState<number[]>(() =>
    dayIndexesFor(mission.target_dates, mission.target_date, weekDates),
  );
  const [score, setScore] = useState<MissionScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();
  const [completePending, startComplete] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const [carryPending, startCarry] = useTransition();
  const [justCarried, setJustCarried] = useState(false);
  // Optimistic local flag OR server-derived — either disables the button.
  const carriedAlready = carriedForward || justCarried;
  const [confirmDialog, confirm] = useConfirm();
  const scoreSeq = useRef(0);
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDescRef = useRef(mission.description);
  const initialDaysRef = useRef(dayIndexes);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoResize(textareaRef, description);

  // Stable string key from target_dates so the reset-effect fires on
  // actual value change, not on every render (mission.target_dates is
  // a fresh array reference every parent re-render, which caused local
  // day-picker state to race with server round-trips and get clobbered).
  const targetDatesKey = (mission.target_dates ?? [mission.target_date]).join(",");
  useEffect(() => {
    setDescription(mission.description);
    initialDescRef.current = mission.description;
    const nextDayIndexes = dayIndexesFor(
      mission.target_dates,
      mission.target_date,
      weekDates,
    );
    setDayIndexes(nextDayIndexes);
    initialDaysRef.current = nextDayIndexes;
    // targetDatesKey encodes mission.target_dates value; deliberately
    // not listed above but referenced here so lint doesn't strip it.
    void targetDatesKey;
  }, [
    mission.id,
    mission.description,
    mission.target_date,
    targetDatesKey,
    weekDates,
  ]);

  useEffect(() => {
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    // Skip scoring on completed missions — the coach's take on a
    // finished mission is noise and the pill is hidden anyway.
    if (mission.status === "completed") {
      setScore(null);
      setScoring(false);
      return;
    }
    if (description.trim().length < 8) {
      setScore(null);
      return;
    }
    setScoring(true);
    scoreTimer.current = setTimeout(async () => {
      const seq = ++scoreSeq.current;
      try {
        const res = await fetch("/api/missions/quality", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            description,
            pillar_code: mission.pillar_code,
            target_date:
              weekDates[dayIndexes[dayIndexes.length - 1]] ?? mission.target_date,
            goal_description: goalDescription,
          }),
        });
        if (seq !== scoreSeq.current) return;
        if (!res.ok) setScore(null);
        else setScore((await res.json()) as MissionScore);
      } finally {
        if (seq === scoreSeq.current) setScoring(false);
      }
    }, 800);
    return () => {
      if (scoreTimer.current) clearTimeout(scoreTimer.current);
    };
  }, [description, dayIndexes, weekDates, mission.pillar_code, mission.target_date, mission.status, goalDescription]);

  const isDone = mission.status === "completed";
  const isMissed = mission.status === "missed";
  const displayDates =
    mission.target_dates && mission.target_dates.length > 0
      ? mission.target_dates
      : [mission.target_date];

  const persistIfChanged = (
    nextDescription: string,
    nextDayIndexes: number[],
  ) => {
    const patch: {
      description?: string;
      target_dates?: string[];
      quality_score?: number | null;
    } = {};
    const trimmed = nextDescription.trim();
    if (trimmed !== initialDescRef.current.trim() && trimmed.length >= 8) {
      patch.description = trimmed;
    }
    if (!sameDayIndexes(nextDayIndexes, initialDaysRef.current)) {
      patch.target_dates = nextDayIndexes.map((i) => weekDates[i]);
    }
    if (score) patch.quality_score = score.total;
    if (Object.keys(patch).length === 0) return;
    setSaveError(null);
    startSave(async () => {
      const res = await updateMission({ mission_id: mission.id, patch });
      if (!res.ok) {
        setSaveError(res.error);
      } else {
        if (patch.description) initialDescRef.current = patch.description;
        if (patch.target_dates) initialDaysRef.current = nextDayIndexes;
      }
    });
  };

  // Score displayed in the pill. For active missions, use the live
  // debounced score. For completed missions, fall back to the score
  // persisted on the row — coach doesn't re-score finished work.
  const displayScore =
    isDone && mission.quality_score !== null
      ? { total: mission.quality_score, ready: mission.quality_score >= 8 }
      : score
        ? { total: score.total, ready: score.ready }
        : null;
  const pillText = displayScore
    ? `${displayScore.total}/10`
    : scoring
      ? "…"
      : null;
  const pillColor = displayScore
    ? displayScore.ready
      ? "var(--color-primary)"
      : displayScore.total >= 6
        ? "var(--color-warning)"
        : "var(--color-danger)"
    : "var(--color-text-muted)";

  return (
    <li className="group bg-[color:var(--color-bg)] px-4 py-3 space-y-2">
      {confirmDialog}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="w-full min-w-0 sm:flex-1">
          {readOnly || isDone ? (
            <p
              className={
                isDone
                  ? "text-sm line-through text-[color:var(--color-text-muted)]"
                  : "text-sm"
              }
            >
              {description}
            </p>
          ) : (
            <textarea
              ref={textareaRef}
              rows={1}
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onFocus={() => setExpanded(true)}
              onBlur={() => {
                setExpanded(false);
                persistIfChanged(description, dayIndexes);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="w-full p-2 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm focus:border-[color:var(--color-primary)] resize-none overflow-hidden"
            />
          )}
          {isMissed && !isDone ? (
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-warning)] mt-1">
              MISSED
            </p>
          ) : null}
        </div>
        {/* Mobile: the three control columns sit together under the
            mission text and wrap if they must. `sm:contents` dissolves
            this wrapper from `sm` up, so they become direct children
            of the row again and line up with the header exactly as
            before. */}
        <div className="flex flex-wrap items-center gap-3 sm:contents">
        <div className={`shrink-0 flex items-center justify-center ${COL_DAY_WIDTH}`}>
          {readOnly || isDone ? (
            <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              {displayDates
                .map((d) => format(new Date(`${d}T00:00:00`), "EEE").toUpperCase())
                .join(" ")}
            </span>
          ) : (
            <DayPicker
              weekDates={weekDates}
              value={dayIndexes}
              onChange={(next) => {
                setDayIndexes(next);
                persistIfChanged(description, next);
              }}
            />
          )}
        </div>
        <div className={`shrink-0 flex items-center justify-center ${COL_COACH_WIDTH}`}>
          {pillText ? (
            isDone ? (
              <span
                className="h-6 px-2 rounded border text-[9px] font-heading tracking-widest inline-flex items-center"
                style={{ color: pillColor, borderColor: pillColor }}
                aria-label={`Coach quality score: ${pillText}`}
              >
                {pillText}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowFeedback((v) => !v)}
                className="h-6 px-2 rounded border text-[9px] font-heading tracking-widest disabled:opacity-40"
                style={{ color: pillColor, borderColor: pillColor }}
                aria-label={`Coach quality score: ${pillText}. Click for details.`}
                title="Coach's take on this mission. Doesn't block saving."
                disabled={!score && !scoring}
              >
                {pillText}
              </button>
            )
          ) : null}
        </div>
        <div className={`shrink-0 flex items-center justify-end gap-1 ${COL_ACTIONS_WIDTH}`}>
          <div className={`shrink-0 flex justify-end ${COL_COMPLETE_SLOT}`}>
            {!readOnly && !isDone ? (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Mark mission complete?",
                    body: "Completing locks this mission — you won't be able to edit the description or day after. Only do this when it's actually done.",
                    confirmLabel: "COMPLETE",
                    cancelLabel: "Not yet",
                  });
                  if (!ok) return;
                  startComplete(async () => {
                    await completeMission(mission.id);
                  });
                }}
                disabled={completePending}
                className="h-6 px-2 rounded border border-[color:var(--color-border)] text-[9px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)] disabled:opacity-40"
              >
                COMPLETE
              </button>
            ) : null}
          </div>
          <div className={`shrink-0 flex justify-end ${COL_NEXT_WEEK_SLOT}`}>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  startCarry(async () => {
                    const res = await carryMissionToNextWeek({ mission_id: mission.id });
                    if (res.ok) setJustCarried(true);
                  })
                }
                disabled={carryPending || carriedAlready}
                className="h-6 px-2 rounded border border-[color:var(--color-border)] text-[9px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)] disabled:opacity-40 disabled:hover:text-[color:var(--color-text-muted)] disabled:hover:border-[color:var(--color-border)] disabled:cursor-not-allowed"
                title={
                  carriedAlready
                    ? "Already carried to next week"
                    : "Duplicate this mission for next week (same days)"
                }
              >
                {carriedAlready ? "✓ CARRIED" : "→ NEXT WEEK"}
              </button>
            ) : null}
          </div>
          <div className={`shrink-0 flex justify-end ${COL_DELETE_SLOT}`}>
            {!readOnly && !isDone ? (
              <button
                type="button"
                onClick={() =>
                  startDelete(async () => {
                    await deleteMission({ mission_id: mission.id });
                  })
                }
                disabled={deletePending}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-6 w-6 rounded text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] transition-opacity"
                aria-label="Delete mission"
                title="Delete"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        </div>
      </div>
      {saveError ? (
        <p className="text-[11px] text-[color:var(--color-danger)] pl-[calc(theme(spacing.3)+1.5rem)]">
          {saveError}
        </p>
      ) : null}
      {savePending ? (
        <p className="text-[9px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          SAVING…
        </p>
      ) : null}
      {showFeedback && score ? (
        <FeedbackPanel
          score={score}
          onDismiss={() => setShowFeedback(false)}
        />
      ) : null}
    </li>
  );
}

/**
 * Multi-select day-of-week picker. `value` is the set of selected day
 * indexes (0=Mon .. 6=Sun). onChange gets the next set.
 *
 * Design details:
 *  - Always requires ≥1 selected day. Tapping the last-selected day
 *    is a no-op (would leave the mission with no date).
 *  - Uses onMouseDown+preventDefault so clicking a button doesn't
 *    steal focus from a sibling textarea. Prevents the blur-triggered
 *    save from racing the click and dropping the day change.
 */
function DayPicker({
  weekDates,
  value,
  onChange,
}: {
  weekDates: string[];
  value: number[];
  onChange: (indexes: number[]) => void;
}) {
  const selected = new Set(value);
  const toggle = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) {
      if (next.size === 1) return;
      next.delete(i);
    } else {
      next.add(i);
    }
    onChange(Array.from(next).sort((a, b) => a - b));
  };
  return (
    <div
      className="shrink-0 flex gap-0.5"
      role="group"
      aria-label="Days of week"
    >
      {DOW_LABELS.map((label, i) => {
        const active = selected.has(i);
        const iso = weekDates[i];
        return (
          <button
            key={i}
            type="button"
            role="checkbox"
            aria-checked={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle(i)}
            className={`h-6 w-5 rounded text-[10px] font-heading tracking-widest ${
              active
                ? "bg-[color:var(--color-primary)] text-white"
                : "text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
            }`}
            title={iso}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function FeedbackPanel({
  score,
  onDismiss,
}: {
  score: MissionScore;
  onDismiss: () => void;
}) {
  const color = score.ready
    ? "var(--color-primary)"
    : score.total >= 6
      ? "var(--color-warning)"
      : "var(--color-danger)";
  return (
    <div
      className="ml-8 p-2 rounded-md bg-[color:var(--color-surface)] border text-xs"
      style={{ borderColor: color }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] font-heading tracking-widest" style={{ color }}>
          {score.ready ? "READY" : score.total >= 6 ? "SHARPEN" : "NOT READY"} · {score.total}/10
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] text-[10px] font-heading tracking-widest"
        >
          HIDE
        </button>
      </div>
      <p className="text-[color:var(--color-text-muted)]">{score.feedback}</p>
    </div>
  );
}

function defaultDayIndex(weekDates: string[]): number {
  const today = new Date().toISOString().slice(0, 10);
  const idx = weekDates.indexOf(today);
  if (idx >= 0) return Math.min(6, idx + 1);
  return 2;
}

/**
 * Resolve the day-of-week indexes for a mission's scheduled days.
 * Prefer target_dates when present; fall back to a single target_date
 * for legacy rows that predate the array column.
 */
function dayIndexesFor(
  targetDates: string[] | null | undefined,
  targetDate: string,
  weekDates: string[],
): number[] {
  const source =
    targetDates && targetDates.length > 0 ? targetDates : [targetDate];
  const indexes = source
    .map((d) => weekDates.indexOf(d))
    .filter((i) => i >= 0);
  if (indexes.length === 0) return [0];
  return indexes.sort((a, b) => a - b);
}

function sameDayIndexes(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
