"use client";

import { useEffect, useRef, useState } from "react";
import { saveReflection } from "./actions";

type Status = "idle" | "saving" | "saved" | "error";

export function ReflectionPanel({
  date,
  initialWins,
  initialLearnings,
  readOnly,
}: {
  date: string;
  initialWins: string;
  initialLearnings: string;
  readOnly: boolean;
}) {
  const [wins, setWins] = useState(initialWins);
  const [learnings, setLearnings] = useState(initialLearnings);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedSignatureRef = useRef(`${initialWins}\u0000${initialLearnings}`);

  // Reset local state when the viewed date changes. /today reuses
  // this component across date navigation (search-param nav doesn't
  // unmount), so without this the wins/learnings text and the
  // savedSignatureRef stay stuck on the first-mounted day.
  useEffect(() => {
    setWins(initialWins);
    setLearnings(initialLearnings);
    savedSignatureRef.current = `${initialWins}\u0000${initialLearnings}`;
    setStatus("idle");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    if (readOnly) return;
    const signature = `${wins}\u0000${learnings}`;
    if (signature === savedSignatureRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    timerRef.current = setTimeout(async () => {
      const res = await saveReflection({
        date,
        wins: wins.length > 0 ? wins : null,
        learnings: learnings.length > 0 ? learnings : null,
      });
      if (res.ok) {
        savedSignatureRef.current = signature;
        setStatus("saved");
        setError(null);
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      } else {
        setStatus("error");
        setError(res.error ?? "Save failed.");
      }
    }, 700);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [wins, learnings, date, readOnly]);

  return (
    <div className="space-y-4">
      <ReflectionCard
        label="KEY WINS"
        placeholder="What worked? Any small victory counts."
        value={wins}
        onChange={setWins}
        readOnly={readOnly}
        status={status}
        error={error}
      />
      <ReflectionCard
        label="KEY LEARNINGS"
        placeholder="What did the day teach you? What'll you do differently?"
        value={learnings}
        onChange={setLearnings}
        readOnly={readOnly}
        status={status}
        error={error}
      />
      <p className="text-[10px] text-[color:var(--color-text-muted)]">
        Auto-saves as you type. Only you and your coach see this — never your community.
      </p>
    </div>
  );
}

function ReflectionCard({
  label,
  placeholder,
  value,
  onChange,
  readOnly,
  status,
  error,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  status: Status;
  error: string | null;
}) {
  return (
    <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-[color:var(--color-border)]">
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
          {label}
        </p>
        <StatusPill status={status} error={error} />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        rows={6}
        maxLength={2000}
        placeholder={placeholder}
        className="w-full p-4 bg-transparent text-sm resize-y min-h-[140px] focus:outline-none focus:ring-0"
      />
    </section>
  );
}

function StatusPill({
  status,
  error,
}: {
  status: Status;
  error: string | null;
}) {
  if (status === "saving") {
    return (
      <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        SAVING…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
        SAVED
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-danger)]">
        {error ?? "ERROR"}
      </span>
    );
  }
  return null;
}
