"use client";

import { useState, useTransition } from "react";

/** `forceable: true` marks jobs that have a time-of-day gate in prod
 *  (only fire during a specific hour window in the community's local
 *  time). Enabling the panel's Force checkbox sends `?force=1`, which
 *  the job function respects by skipping the gate. Other filters
 *  (dedup keys, "already logged today?", target_date) still apply,
 *  so force is safe — it just lets a platform admin trigger a full
 *  pass mid-day for testing without waiting for 6pm / 8am. */
const JOBS: Array<{
  key: string;
  label: string;
  note: string;
  forceable?: boolean;
}> = [
  { key: "daily-reminders", label: "Daily reminders", note: "Log-today emails + bell notifications to members who haven't checked in yet. Time-gated to community reminder hour (default 18:00 local).", forceable: true },
  { key: "mission-nudges", label: "Mission-day nudges", note: "Morning-of email for missions dated today. Time-gated to 08:00 local.", forceable: true },
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
  const [forceByKey, setForceByKey] = useState<Record<string, boolean>>({});

  const runJob = (key: string) => {
    setRunning(key);
    const force = forceByKey[key] === true;
    start(async () => {
      try {
        const qs = new URLSearchParams({ job: key });
        if (force) qs.set("force", "1");
        const res = await fetch(`/api/cron/run?${qs.toString()}`, {
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
        const force = forceByKey[j.key] === true;
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
            {j.forceable ? (
              <label className="flex items-center gap-1.5 text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) =>
                    setForceByKey((prev) => ({ ...prev, [j.key]: e.target.checked }))
                  }
                  className="accent-[color:var(--color-accent)]"
                />
                FORCE
              </label>
            ) : null}
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
