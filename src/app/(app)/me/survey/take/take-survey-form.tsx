"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { answeredCount, type DraftAnswer } from "@/lib/survey/progress";
import { discardSurvey, finishSurvey, saveSurveyAnswer, saveSurveyContext } from "../actions";

type Q = { id: string; sort_order: number; text: string };
type Answer = { score: number | null; note: string };
type SaveState = "saving" | "saved" | "error";

const NOTE_DEBOUNCE_MS = 800;

/**
 * Every score saves on tap and every note saves after a short pause or when
 * the box loses focus. Saves run one at a time in the order they were made,
 * so an older save can never land after a newer one.
 */
export function TakeSurveyForm({
  questions,
  initialAnswers,
  initialContext,
  hasDraft,
}: {
  questions: Q[];
  initialAnswers: DraftAnswer[];
  initialContext: string;
  hasDraft: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    const saved = new Map(initialAnswers.map((a) => [a.question_id, a]));
    return Object.fromEntries(
      questions.map((q) => [q.id, { score: saved.get(q.id)?.score ?? null, note: saved.get(q.id)?.note ?? "" }]),
    );
  });
  const [contextNote, setContextNote] = useState(initialContext);
  const [status, setStatus] = useState<Record<string, SaveState>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const contextRef = useRef(contextNote);
  contextRef.current = contextNote;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlight = useRef(0);

  const enqueue = useCallback((key: string, run: () => Promise<{ ok: boolean; error?: string }>) => {
    inFlight.current += 1;
    setStatus((s) => ({ ...s, [key]: "saving" }));
    queue.current = queue.current
      .then(run)
      .then(
        (res) => {
          setStatus((s) => ({ ...s, [key]: res.ok ? "saved" : "error" }));
          if (!res.ok) setError(res.error ?? "Couldn't save. Try again.");
        },
        () => {
          setStatus((s) => ({ ...s, [key]: "error" }));
          setError("Couldn't save. Check your connection and try again.");
        },
      )
      .finally(() => {
        inFlight.current -= 1;
      });
  }, []);

  const saveQuestion = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.delete(id);
      // Read the answer when the save runs, so it sends the latest words.
      enqueue(id, () => {
        const a = answersRef.current[id];
        return saveSurveyAnswer({ question_id: id, score: a.score, note: a.note });
      });
    },
    [enqueue],
  );

  const saveContext = useCallback(() => {
    const t = timers.current.get("context");
    if (t) clearTimeout(t);
    timers.current.delete("context");
    enqueue("context", () => saveSurveyContext(contextRef.current));
  }, [enqueue]);

  const later = (key: string, fn: () => void) => {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.set(key, setTimeout(fn, NOTE_DEBOUNCE_MS));
  };

  /** Send anything still waiting on its pause, then wait for every save. */
  const flush = async () => {
    for (const key of [...timers.current.keys()]) {
      if (key === "context") saveContext();
      else saveQuestion(key);
    }
    await queue.current;
  };

  // Warn before leaving while a save hasn't landed yet.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (timers.current.size > 0 || inFlight.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const setScore = (id: string, score: number) => {
    setAnswers((prev) => {
      const next = { ...prev, [id]: { ...prev[id], score } };
      answersRef.current = next;
      return next;
    });
    saveQuestion(id);
  };

  const setNote = (id: string, note: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [id]: { ...prev[id], note } };
      answersRef.current = next;
      return next;
    });
    later(id, () => saveQuestion(id));
  };

  const finish = () => {
    setError(null);
    start(async () => {
      await flush();
      const res = await finishSurvey();
      if (!res.ok) setError(res.error ?? "Couldn't finish. Try again.");
    });
  };

  const discard = () => {
    if (!window.confirm("Discard this survey and every answer in it?")) return;
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    start(async () => {
      await queue.current;
      const res = await discardSurvey();
      if (!res.ok) setError(res.error ?? "Couldn't discard. Try again.");
    });
  };

  const done = answeredCount(
    questions.map((q) => q.id),
    questions.map((q) => ({ question_id: q.id, ...answers[q.id] })),
  );

  return (
    <form action={finish} className="space-y-6">
      <p className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">
        {done} OF {questions.length} ANSWERED
      </p>

      <label className="block">
        <span className="flex items-baseline justify-between text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          CONTEXT (OPTIONAL)
          <SaveMark state={status.context} />
        </span>
        <input
          value={contextNote}
          onChange={(e) => {
            const v = e.target.value;
            setContextNote(v);
            contextRef.current = v;
            later("context", saveContext);
          }}
          onBlur={() => {
            if (timers.current.has("context")) saveContext();
          }}
          placeholder="Post-vacation, after the tough month, etc."
          className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
        />
      </label>

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li
            key={q.id}
            className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          >
            <p className="flex items-baseline justify-between text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              QUESTION {i + 1}
              <SaveMark state={status[q.id]} />
            </p>
            <p className="text-base font-heading mt-1">{q.text}</p>
            <div className="flex items-center gap-2 mt-3">
              {[1, 2, 3, 4, 5].map((s) => {
                const selected = answers[q.id].score === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScore(q.id, s)}
                    className="h-10 w-10 rounded-md font-heading text-sm"
                    style={{
                      background: selected ? "var(--color-accent)" : "var(--color-surface-2)",
                      color: selected ? "black" : "var(--color-text-muted)",
                      border: selected ? "none" : "1px solid var(--color-border)",
                    }}
                    aria-pressed={selected}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <textarea
              rows={2}
              value={answers[q.id].note}
              onChange={(e) => setNote(q.id, e.target.value)}
              onBlur={() => {
                if (timers.current.has(q.id)) saveQuestion(q.id);
              }}
              placeholder="Her words. Verbatim."
              className="mt-3 w-full p-2 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
            />
          </li>
        ))}
      </ol>

      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Finish survey"}
        </Button>
        {hasDraft || done > 0 || Object.keys(status).length > 0 ? (
          <button
            type="button"
            onClick={discard}
            disabled={pending}
            className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)]"
          >
            Discard survey
          </button>
        ) : null}
      </div>
    </form>
  );
}

function SaveMark({ state }: { state: SaveState | undefined }) {
  if (!state) return null;
  const text = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Not saved";
  return (
    <span
      aria-live="polite"
      className="normal-case tracking-normal"
      style={{ color: state === "error" ? "var(--color-danger)" : "var(--color-text-muted)" }}
    >
      {text}
    </span>
  );
}
