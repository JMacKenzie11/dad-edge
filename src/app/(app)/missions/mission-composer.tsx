"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { CHOOSABLE_PILLARS, PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { createMission } from "./actions";
import {
  CRITERIA,
  CRITERION_LABEL,
  type MissionScore,
  type Criterion,
} from "@/lib/coach/mission-quality";

type ExamplesResponse = { seed: string[]; promoted: string[] };

export function MissionComposer({
  communityId,
  goalId,
  goalDescription,
  fixedPillar,
  weekDates,
}: {
  communityId: string | null;
  goalId: string | null;
  goalDescription: string | null;
  fixedPillar: PillarCode | null;
  weekDates: string[];
}) {
  const [pillar, setPillar] = useState<PillarCode>(fixedPillar ?? CHOOSABLE_PILLARS[0].code);
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState(defaultDate(weekDates));
  const [score, setScore] = useState<MissionScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showExamples, setShowExamples] = useState(false);
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreSeq = useRef(0);

  // Debounced quality score whenever description / pillar / date / goal changes.
  useEffect(() => {
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    if (description.trim().length < 6) {
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
            pillar_code: pillar,
            target_date: targetDate || null,
            goal_description: goalDescription,
          }),
        });
        if (seq !== scoreSeq.current) return; // stale
        if (!res.ok) {
          setScore(null);
        } else {
          setScore((await res.json()) as MissionScore);
        }
      } finally {
        if (seq === scoreSeq.current) setScoring(false);
      }
    }, 700);
    return () => {
      if (scoreTimer.current) clearTimeout(scoreTimer.current);
    };
  }, [description, pillar, targetDate, goalDescription]);

  const save = () => {
    if (!communityId) {
      setSaveError("You need to be in a community to save a mission.");
      return;
    }
    setSaveError(null);
    startTransition(async () => {
      const res = await createMission({
        community_id: communityId,
        pillar_code: pillar,
        description: description.trim(),
        target_date: targetDate,
        quarterly_goal_id: goalId,
        quality_score: score?.total ?? null,
      });
      if (res.ok) {
        // Parent BucketSection re-keys and remounts us after revalidation, so
        // no manual reset needed — but clear description eagerly for snappy UX.
        setDescription("");
        setScore(null);
      } else {
        setSaveError(res.error);
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Pillar chip / picker */}
      {fixedPillar ? (
        <div className="flex items-center gap-2 text-xs">
          <span
            className="h-4 w-4 rounded"
            style={{ background: PILLAR_BY_CODE[fixedPillar].colorVar }}
          />
          <span className="font-heading tracking-widest">
            {PILLAR_BY_CODE[fixedPillar].label.toUpperCase()}
          </span>
          <span className="text-[color:var(--color-text-muted)]">· from goal</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {CHOOSABLE_PILLARS.map((p) => {
            const active = pillar === p.code;
            return (
              <button
                type="button"
                key={p.code}
                onClick={() => setPillar(p.code)}
                className="h-7 px-2 rounded-[var(--radius-chip)] text-[10px] font-heading tracking-widest border"
                style={{
                  background: active ? p.colorVar : "transparent",
                  color: active ? "black" : "var(--color-text-muted)",
                  borderColor: active ? p.colorVar : "var(--color-border)",
                }}
              >
                {p.label.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}

      <textarea
        rows={3}
        maxLength={280}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Behavior + day. e.g. Take my wife to dinner Thursday, phone in the car."
        className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm focus:border-[color:var(--color-primary)]"
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
            TARGET DAY
          </span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            min={weekDates[0]}
            className="h-9 px-2 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => setShowExamples((v) => !v)}
          className="self-end h-9 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-[10px] tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)]"
        >
          {showExamples ? "HIDE EXAMPLES" : "SEE EXAMPLES"}
        </button>
      </div>

      {showExamples ? (
        <ExamplesPanel pillar={pillar} onPick={(t) => setDescription(t)} />
      ) : null}

      <QualityPanel score={score} scoring={scoring} onApplyRewrite={(t) => setDescription(t)} />

      {saveError ? (
        <p className="text-xs text-[color:var(--color-danger)]">{saveError}</p>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={pending || description.trim().length < 8}
          className="h-9 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-[10px] tracking-widest disabled:opacity-40"
        >
          {pending ? "SAVING…" : "SAVE MISSION"}
        </button>
      </div>
    </div>
  );
}

function QualityPanel({
  score,
  scoring,
  onApplyRewrite,
}: {
  score: MissionScore | null;
  scoring: boolean;
  onApplyRewrite: (text: string) => void;
}) {
  if (!score && !scoring) return null;
  if (!score) {
    return (
      <div className="p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-xs text-[color:var(--color-text-muted)]">
        Scoring quality…
      </div>
    );
  }
  const color = score.ready
    ? "var(--color-primary)"
    : score.total >= 6
      ? "var(--color-warning)"
      : "var(--color-danger)";
  return (
    <div className="p-3 rounded-md bg-[color:var(--color-bg)] border" style={{ borderColor: color }}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] font-heading tracking-widest" style={{ color }}>
          {score.ready ? "READY" : score.total >= 6 ? "NEEDS TIGHTENING" : "NOT READY"}
        </p>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {score.total}/10
        </p>
      </div>
      <div className="grid grid-cols-5 gap-1 mb-2">
        {CRITERIA.map((c) => (
          <CriterionPip key={c} label={CRITERION_LABEL[c]} value={score.scores[c as Criterion]} />
        ))}
      </div>
      <p className="text-xs text-[color:var(--color-text-muted)]">{score.feedback}</p>
      {score.rewrite ? (
        <div className="mt-2 flex items-start gap-2">
          <p className="text-xs flex-1">
            <span className="text-[color:var(--color-text-muted)]">Try: </span>
            {score.rewrite}
          </p>
          <button
            type="button"
            onClick={() => onApplyRewrite(score.rewrite!)}
            className="h-7 px-2 rounded border border-[color:var(--color-primary)] text-[color:var(--color-primary)] font-heading text-[10px] tracking-widest shrink-0"
          >
            USE
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CriterionPip({ label, value }: { label: string; value: 0 | 1 | 2 }) {
  const color =
    value === 2 ? "var(--color-primary)" : value === 1 ? "var(--color-warning)" : "var(--color-danger)";
  return (
    <div className="text-center">
      <div className="h-1.5 rounded" style={{ background: color }} />
      <p className="text-[9px] font-heading tracking-widest mt-1 text-[color:var(--color-text-muted)]">
        {label.toUpperCase()}
      </p>
    </div>
  );
}

function ExamplesPanel({
  pillar,
  onPick,
}: {
  pillar: PillarCode;
  onPick: (text: string) => void;
}) {
  const [items, setItems] = useState<{ seed: string[]; promoted: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/missions/examples?pillar_code=${encodeURIComponent(pillar)}`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as ExamplesResponse;
        if (!cancelled) setItems(body);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pillar]);

  return (
    <div className="p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]">
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
        EXAMPLES · {PILLAR_BY_CODE[pillar].label.toUpperCase()}
      </p>
      {loading || !items ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">Loading…</p>
      ) : (
        <ul className="space-y-1.5">
          {[...items.promoted, ...items.seed].slice(0, 8).map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => onPick(t)}
                className="text-left text-xs hover:text-[color:var(--color-primary)] flex-1"
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function defaultDate(weekDates: string[]): string {
  // Tomorrow if it's in the week, else Wednesday of the current week.
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);
  if (weekDates.includes(tomorrowISO)) return tomorrowISO;
  if (weekDates.includes(today)) return today;
  return weekDates[2] ?? weekDates[0];
}
