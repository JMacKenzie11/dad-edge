"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { submitSurvey } from "../actions";

type Q = { id: string; sort_order: number; text: string };

export function TakeSurveyForm({
  questionSetId,
  questions,
}: {
  questionSetId: string;
  questions: Q[];
}) {
  const [answers, setAnswers] = useState<Record<string, { score: number | null; note: string }>>(
    () => Object.fromEntries(questions.map((q) => [q.id, { score: null, note: "" }])),
  );
  const [contextNote, setContextNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    const missing = questions.filter((q) => answers[q.id].score === null);
    if (missing.length > 0) {
      setError(`Score every question. Missing ${missing.length}.`);
      return;
    }
    const noteMissing = questions.filter((q) => !answers[q.id].note.trim());
    if (noteMissing.length > 0) {
      setError(`Notes required for every question. Her words matter.`);
      return;
    }
    start(async () => {
      const res = await submitSurvey({
        question_set_id: questionSetId,
        context_note: contextNote.trim() || null,
        responses: questions.map((q) => ({
          question_id: q.id,
          score: answers[q.id].score as number,
          note: answers[q.id].note.trim(),
        })),
      });
      if (!res.ok) setError(res.error ?? "Save failed.");
    });
  };

  return (
    <form action={submit} className="space-y-6">
      <label className="block">
        <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          CONTEXT (OPTIONAL)
        </span>
        <input
          value={contextNote}
          onChange={(e) => setContextNote(e.target.value)}
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
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              QUESTION {i + 1}
            </p>
            <p className="text-base font-heading mt-1">{q.text}</p>
            <div className="flex items-center gap-2 mt-3">
              {[1, 2, 3, 4, 5].map((s) => {
                const selected = answers[q.id].score === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setAnswers({ ...answers, [q.id]: { ...answers[q.id], score: s } })
                    }
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
              onChange={(e) =>
                setAnswers({ ...answers, [q.id]: { ...answers[q.id], note: e.target.value } })
              }
              placeholder="Her words. Verbatim."
              className="mt-3 w-full p-2 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
            />
          </li>
        ))}
      </ol>

      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save survey"}
      </Button>
    </form>
  );
}
