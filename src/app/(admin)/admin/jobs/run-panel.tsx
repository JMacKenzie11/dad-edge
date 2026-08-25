"use client";

import { useState, useTransition } from "react";

const JOBS = [
  { key: "daily-reminders", label: "Daily reminders", note: "Log-today emails + bell notifications to members who haven't checked in yet." },
  { key: "mission-nudges", label: "Mission-day nudges", note: "Morning-of email for missions dated today." },
  { key: "disengagement", label: "Disengagement scan", note: "Day 3 / 7 / 14 emails." },
  { key: "week-lock", label: "Week lock", note: "Insert current-week rows, lock last week, warn members 2 days before lock (email + bell)." },
  { key: "mark-missed", label: "Mark missed", note: "Move planned missions past their target date to missed." },
  { key: "digest", label: "Weekly digest", note: "Generate and email last week's digest to leaders (+ bell notification)." },
  { key: "exemplar-novelty", label: "Exemplar novelty scan", note: "Prune near-duplicate exemplar missions per pillar (weekly)." },
  { key: "mark-goals-for-review", label: "Mark goals for review", note: "Flip active goals to needs_review when quarter is closing; bell notifies each coachee." },
  { key: "goal-midpoint-check", label: "Goal midpoint check", note: "Bell-notify coachees whose midpoint_check_at has arrived and isn't answered." },
];

type RunResult = { ok: boolean; sent?: number; processed?: number; errors?: string[] };

export function RunJobsPanel() {
  const [pending, start] = useTransition();
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [running, setRunning] = useState<string | null>(null);

  const runJob = (key: string) => {
    setRunning(key);
    start(async () => {
      try {
        const res = await fetch(`/api/cron/run?job=${encodeURIComponent(key)}`, {
          method: "POST",
        });
        const body = (await res.json()) as RunResult;
        setResults((prev) => ({ ...prev, [key]: body }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [key]: { ok: false, errors: [err instanceof Error ? err.message : "failed"] },
        }));
      } finally {
        setRunning(null);
      }
    });
  };

  return (
    <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
      {JOBS.map((j) => {
        const r = results[j.key];
        const busy = pending && running === j.key;
        return (
          <li key={j.key} className="px-4 py-3 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-heading text-sm">{j.label}</p>
              <p className="text-xs text-[color:var(--color-text-muted)]">{j.note}</p>
              {r ? (
                <p
                  className="text-xs mt-1"
                  style={{ color: r.ok ? "var(--color-success)" : "var(--color-danger)" }}
                >
                  {r.ok ? "OK" : "FAILED"}
                  {typeof r.sent === "number" ? ` · sent ${r.sent}` : ""}
                  {typeof r.processed === "number" ? ` · processed ${r.processed}` : ""}
                  {r.errors?.length ? ` · ${r.errors.join("; ")}` : ""}
                </p>
              ) : null}
            </div>
            <button
              onClick={() => runJob(j.key)}
              disabled={busy}
              className="h-9 px-3 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest disabled:opacity-40"
            >
              {busy ? "RUNNING…" : "RUN"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
