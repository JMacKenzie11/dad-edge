"use client";

import { useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcMessage,
  ItcTest,
  ItcTestType,
} from "@/lib/itc/maps";
import { abandonInFlightTest, saveTest } from "../actions";
import { EntryThread } from "./entry-thread";

/**
 * Test design form. Renders the four Kegan/Lahey worksheet fields
 * (My Big Assumption Says / So I Will / And Collect the Following
 * Data / In Order to Find Out Whether) plus test_type + target_date.
 *
 * On advance to test_design the server pre-drafts a test via
 * draftTestForAssumption and persists it — so on first render the
 * form is populated with the coach's draft, not empty. Coachee
 * edits any field, hits Save; save fires reviewTestDesign whose
 * prose lands as the entry thread above the form.
 *
 * If the coachee decides to test a different assumption mid-design,
 * the "← Back to prioritize" affordance calls abandonInFlightTest
 * (marks test as abandoned, reverts stage to prioritize with the
 * picker + history badges).
 */
export function TestDesignForm({
  mapId,
  test,
  assumption,
  thread,
}: {
  mapId: string;
  /** The current test row (pre-drafted by the server on advance).
   *  Null only in the edge case where the LLM failed to draft — form
   *  renders empty and coachee fills from scratch. */
  test: ItcTest | null;
  /** The assumption being tested. Used to render context above the
   *  form and to seed assumption_id on saves when the test doesn't
   *  yet exist. */
  assumption: ItcAssumption;
  /** Coach review messages anchored to the test row. Rendered above
   *  the form so the coachee can read the review while editing. */
  thread: ItcMessage[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [testType, setTestType] = useState<ItcTestType>(
    test?.test_type ?? "behavioral",
  );
  const [assumptionSays, setAssumptionSays] = useState(
    test?.assumption_says ?? assumption.text,
  );
  const [behaviorChange, setBehaviorChange] = useState(
    test?.behavior_change ?? "",
  );
  const [dataToCollect, setDataToCollect] = useState(
    test?.data_to_collect ?? "",
  );
  const [inOrderToFindOut, setInOrderToFindOut] = useState(
    test?.in_order_to_find_out ?? "",
  );
  const [targetDate, setTargetDate] = useState(
    test?.target_date ?? defaultTargetDate(),
  );

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    if (test?.id) fd.set("test_id", test.id);
    fd.set("assumption_id", assumption.id);
    fd.set("test_type", testType);
    fd.set("assumption_says", assumptionSays.trim());
    fd.set("behavior_change", behaviorChange.trim());
    fd.set("data_to_collect", dataToCollect.trim());
    fd.set("in_order_to_find_out", inOrderToFindOut.trim());
    fd.set("target_date", targetDate);
    startTransition(async () => {
      const res = await saveTest(fd);
      if (!res.ok) setError(res.reason ?? "Could not save test.");
    });
  }

  function goBackToPrioritize() {
    if (!test?.id) {
      // No test to abandon — coachee just navigates back. In practice
      // this shouldn't happen (server pre-drafts on advance) but
      // handle it gracefully.
      window.location.reload();
      return;
    }
    if (
      !confirm(
        "Abandon this test and pick a different assumption? Your current design will be marked abandoned but preserved in history.",
      )
    ) {
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("test_id", test.id);
    startTransition(async () => {
      const res = await abandonInFlightTest(fd);
      if (!res.ok) setError(res.reason ?? "Could not abandon.");
    });
  }

  return (
    <div className="space-y-4">
      {thread.length > 0 && test ? (
        <EntryThread messages={thread} chipTarget="assumption" />
      ) : null}

      <div className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-4 py-3 text-sm">
        <div className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)] mb-2">
          Testing this assumption
        </div>
        <div className="italic text-white/90 leading-relaxed">
          {assumption.text}
        </div>
      </div>

      <div className="space-y-3">
        <Field
          label="My Big Assumption Says"
          hint="Verbatim from the map, sharpened with what it specifically predicts."
          value={assumptionSays}
          onChange={setAssumptionSays}
          rows={2}
          disabled={pending}
        />

        <Field
          label="So I Will (Change my Behavior This Way)"
          hint="One specific move in one specific moment. Modest — worst case must be livable."
          value={behaviorChange}
          onChange={setBehaviorChange}
          rows={2}
          disabled={pending}
        />

        <Field
          label="And Collect the Following Data"
          hint="Observable (what would show up on a videotape) + felt. Not interpretive."
          value={dataToCollect}
          onChange={setDataToCollect}
          rows={2}
          disabled={pending}
        />

        <Field
          label="In Order to Find Out Whether"
          hint="What would tell you the assumption doesn't hold. Name the disconfirmation."
          value={inOrderToFindOut}
          onChange={setInOrderToFindOut}
          rows={2}
          disabled={pending}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
              Type of test
            </span>
            <select
              value={testType}
              onChange={(e) => setTestType(e.target.value as ItcTestType)}
              disabled={pending}
              className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
            >
              <option value="behavioral">Behavioral (do something different)</option>
              <option value="observation">Observation (watch, don't act)</option>
              <option value="data_mining">Data mining (look at what's already happened)</option>
              <option value="thought_experiment">Thought experiment (imagine, don't act)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
              Target date
            </span>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              disabled={pending}
              className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save this test"}
        </button>
        <button
          type="button"
          onClick={goBackToPrioritize}
          disabled={pending}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-2 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          title="Abandon this test and pick a different assumption"
        >
          ← Test a different assumption
        </button>
      </div>

      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  rows,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  disabled: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        disabled={disabled}
        className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm leading-relaxed"
      />
      <span className="block text-[11px] text-[color:var(--color-text-muted)]/70 italic">
        {hint}
      </span>
    </label>
  );
}

function defaultTargetDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}
