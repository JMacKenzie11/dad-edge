"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { format } from "date-fns";
import {
  createMission,
  updateMission,
  deleteMission,
  completeMission,
} from "./actions";
import type { WeekMission } from "./page";
import type { MissionScore } from "@/lib/coach/mission-quality";

const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

// Fixed pixel widths so header, empty, and filled rows line up in every
// state (with or without coach pill, with or without action buttons,
// completed with just a "TUE" span vs. editable with a full day picker).
// Kept in sync with the column-header widths in weekly-planner.tsx.
const COL_DAY_WIDTH = "w-[152px]"; // 7 buttons × 20px + 6 gaps × 2px
const COL_COACH_WIDTH = "w-[92px]"; // fits "SHARPEN 10/10"
const COL_ACTIONS_WIDTH = "w-[104px]"; // COMPLETE + × + gap

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
  const [dayIndex, setDayIndex] = useState<number>(defaultDayIndex(weekDates));
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
            target_date: weekDates[dayIndex],
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
  }, [description, dayIndex, weekDates, pillarCode, goalDescription]);

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
    const targetDate = weekDates[dayIndex];
    setError(null);
    startTransition(async () => {
      const res = await createMission({
        community_id: communityId,
        pillar_code: pillarCode,
        description: description.trim(),
        target_date: targetDate,
        quarterly_goal_id: goalId,
      });
      if (!res.ok) {
        setError(res.error);
      }
    });
  };

  const canSave = description.trim().length >= 8;

  const qualityLabel = score
    ? score.ready
      ? "READY"
      : score.total >= 6
        ? "SHARPEN"
        : "SOFT"
    : scoring
      ? "…"
      : null;
  const qualityColor = score
    ? score.ready
      ? "var(--color-primary)"
      : score.total >= 6
        ? "var(--color-warning)"
        : "var(--color-danger)"
    : "var(--color-text-muted)";

  return (
    <li className="bg-[color:var(--color-bg)] px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
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
          className="flex-1 min-w-0 p-2 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm focus:border-[color:var(--color-primary)] resize-none overflow-hidden"
        />
        <div className={`shrink-0 flex items-center justify-center ${COL_DAY_WIDTH}`}>
          <DayPicker weekDates={weekDates} value={dayIndex} onChange={setDayIndex} />
        </div>
        <div className={`shrink-0 flex items-center justify-center ${COL_COACH_WIDTH}`}>
          {qualityLabel ? (
            <button
              type="button"
              onClick={() => setShowFeedback((v) => !v)}
              onMouseEnter={() => {
                if (score) setShowFeedback(true);
              }}
              className="h-6 px-2 rounded border text-[9px] font-heading tracking-widest disabled:opacity-40"
              style={{ color: qualityColor, borderColor: qualityColor }}
              aria-label={`Coach quality: ${qualityLabel}${score ? ` ${score.total}/10` : ""}. Click for details.`}
              title="Coach's take on this mission. Doesn't block saving."
              disabled={!score && !scoring}
            >
              {qualityLabel}
              {score ? ` ${score.total}/10` : ""}
            </button>
          ) : null}
        </div>
        <div className={`shrink-0 ${COL_ACTIONS_WIDTH}`} aria-hidden="true" />
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
          onApplyRewrite={(text) => setDescription(text)}
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
  readOnly,
}: SlotProps & { mission: WeekMission }) {
  const [description, setDescription] = useState(mission.description);
  const [dayIndex, setDayIndex] = useState(dayIndexFor(mission.target_date, weekDates));
  const [score, setScore] = useState<MissionScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();
  const [completePending, startComplete] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const scoreSeq = useRef(0);
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDescRef = useRef(mission.description);
  const initialDayRef = useRef(dayIndex);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoResize(textareaRef, description);

  useEffect(() => {
    setDescription(mission.description);
    initialDescRef.current = mission.description;
    const nextDayIndex = dayIndexFor(mission.target_date, weekDates);
    setDayIndex(nextDayIndex);
    initialDayRef.current = nextDayIndex;
  }, [mission.id, mission.description, mission.target_date, weekDates]);

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
            target_date: weekDates[dayIndex] ?? mission.target_date,
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
  }, [description, dayIndex, weekDates, mission.pillar_code, mission.target_date, mission.status, goalDescription]);

  const isDone = mission.status === "completed";
  const isMissed = mission.status === "missed";
  const targetDate = weekDates[dayIndex] ?? mission.target_date;

  const persistIfChanged = (nextDescription: string, nextDayIndex: number) => {
    const patch: {
      description?: string;
      target_date?: string;
      quality_score?: number | null;
    } = {};
    const trimmed = nextDescription.trim();
    if (trimmed !== initialDescRef.current.trim() && trimmed.length >= 8) {
      patch.description = trimmed;
    }
    if (nextDayIndex !== initialDayRef.current) {
      patch.target_date = weekDates[nextDayIndex];
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
        if (patch.target_date) initialDayRef.current = nextDayIndex;
      }
    });
  };

  const applyRewrite = (text: string) => {
    setDescription(text);
    persistIfChanged(text, dayIndex);
  };

  const qualityLabel = score
    ? score.ready
      ? "READY"
      : score.total >= 6
        ? "SHARPEN"
        : "SOFT"
    : scoring
      ? "…"
      : null;
  const qualityColor = isDone
    ? "var(--color-text-muted)"
    : score
      ? score.ready
        ? "var(--color-primary)"
        : score.total >= 6
          ? "var(--color-warning)"
          : "var(--color-danger)"
      : "var(--color-text-muted)";

  return (
    <li className="group bg-[color:var(--color-bg)] px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
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
                persistIfChanged(description, dayIndex);
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
        <div className={`shrink-0 flex items-center justify-center ${COL_DAY_WIDTH}`}>
          {readOnly || isDone ? (
            <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              {format(new Date(`${targetDate}T00:00:00`), "EEE").toUpperCase()}
            </span>
          ) : (
            <DayPicker
              weekDates={weekDates}
              value={dayIndex}
              onChange={(idx) => {
                setDayIndex(idx);
                persistIfChanged(description, idx);
              }}
            />
          )}
        </div>
        <div className={`shrink-0 flex items-center justify-center ${COL_COACH_WIDTH}`}>
          {!isDone && qualityLabel ? (
            <button
              type="button"
              onClick={() => setShowFeedback((v) => !v)}
              onMouseEnter={() => {
                if (score) setShowFeedback(true);
              }}
              className="h-6 px-2 rounded border text-[9px] font-heading tracking-widest disabled:opacity-40"
              style={{ color: qualityColor, borderColor: qualityColor }}
              aria-label={`Coach quality: ${qualityLabel}${score ? ` ${score.total}/10` : ""}. Click for details.`}
              title="Coach's take on this mission. Doesn't block saving."
              disabled={!score && !scoring}
            >
              {qualityLabel}
              {score ? ` ${score.total}/10` : ""}
            </button>
          ) : null}
        </div>
        <div className={`shrink-0 flex items-center justify-end gap-1 ${COL_ACTIONS_WIDTH}`}>
          {!readOnly && !isDone ? (
            <>
              <button
                type="button"
                onClick={() =>
                  startComplete(async () => {
                    await completeMission(mission.id);
                  })
                }
                disabled={completePending}
                className="h-6 px-2 rounded border border-[color:var(--color-border)] text-[9px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)] disabled:opacity-40"
              >
                COMPLETE
              </button>
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
            </>
          ) : null}
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
          onApplyRewrite={applyRewrite}
          onDismiss={() => setShowFeedback(false)}
        />
      ) : null}
    </li>
  );
}

function DayPicker({
  weekDates,
  value,
  onChange,
}: {
  weekDates: string[];
  value: number;
  onChange: (idx: number) => void;
}) {
  return (
    <div className="shrink-0 flex gap-0.5" role="radiogroup" aria-label="Day of week">
      {DOW_LABELS.map((label, i) => {
        const active = i === value;
        const iso = weekDates[i];
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(i)}
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
  onApplyRewrite,
  onDismiss,
}: {
  score: MissionScore;
  onApplyRewrite: (text: string) => void;
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
      {score.rewrite ? (
        <div className="mt-1.5 flex items-start gap-2">
          <p className="flex-1">
            <span className="text-[color:var(--color-text-muted)]">Try: </span>
            {score.rewrite}
          </p>
          <button
            type="button"
            onClick={() => onApplyRewrite(score.rewrite!)}
            className="shrink-0 text-[10px] font-heading tracking-widest text-[color:var(--color-primary)] hover:underline"
          >
            USE
          </button>
        </div>
      ) : null}
    </div>
  );
}

function defaultDayIndex(weekDates: string[]): number {
  const today = new Date().toISOString().slice(0, 10);
  const idx = weekDates.indexOf(today);
  if (idx >= 0) return Math.min(6, idx + 1);
  return 2;
}

function dayIndexFor(iso: string, weekDates: string[]): number {
  const i = weekDates.indexOf(iso);
  return i >= 0 ? i : 0;
}
