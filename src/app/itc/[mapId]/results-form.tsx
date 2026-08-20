"use client";

import { useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcAssumptionVerdict,
  ItcMessage,
  ItcNextStep,
  ItcTest,
  ItcTestResult,
} from "@/lib/itc/maps";
import { advanceAfterResults, saveTestResult } from "../actions";
import { EntryThread } from "./entry-thread";

/**
 * Results form — the coachee's post-test debrief. Kegan/Lahey four
 * field labels verbatim (My Big Assumption Says is context above the
 * form; three narrative fields to fill; two operational picks —
 * verdict + next step). Save fires reviewTestResult LLM; coach's
 * Kegan-voice interpretation lands as an entry_thread on the result
 * row.
 *
 * After save + review, coachee clicks "Continue to what's next" which
 * routes based on the saved next_step (new_test → back to test_design,
 * new_assumption → back to prioritize with test history badges,
 * map_complete → done).
 */
export function ResultsForm({
  mapId,
  test,
  assumption,
  result,
  thread,
}: {
  mapId: string;
  test: ItcTest;
  assumption: ItcAssumption;
  /** Pre-drafted scaffold from the server (on advance) or the
   *  coachee's saved edits. Null in the edge case where the LLM
   *  scaffold failed — coachee fills from scratch. */
  result: ItcTestResult | null;
  /** Coach review messages anchored to the result row. Rendered
   *  above the form. */
  thread: ItcMessage[];
}) {
  const [pending, startTransition] = useTransition();
  const [advancing, startAdvance] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(Boolean(result?.what_i_did));

  const [ranOn, setRanOn] = useState(
    result?.ran_on ?? new Date().toISOString().slice(0, 10),
  );
  const [whatIDid, setWhatIDid] = useState(result?.what_i_did ?? "");
  const [dataCollected, setDataCollected] = useState(
    result?.data_collected ?? "",
  );
  const [whatItSays, setWhatItSays] = useState(
    result?.what_it_says_about_assumption ?? "",
  );
  const [verdict, setVerdict] = useState<ItcAssumptionVerdict>(
    result?.assumption_verdict ?? "partially_challenged",
  );
  const [nextStep, setNextStep] = useState<ItcNextStep>(
    result?.next_step ?? "new_test",
  );

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("test_id", test.id);
    if (result?.id) fd.set("result_id", result.id);
    fd.set("ran_on", ranOn);
    fd.set("what_i_did", whatIDid.trim());
    fd.set("data_collected", dataCollected.trim());
    fd.set("what_it_says_about_assumption", whatItSays.trim());
    fd.set("assumption_verdict", verdict);
    fd.set("next_step", nextStep);
    startTransition(async () => {
      const res = await saveTestResult(fd);
      if (!res.ok) setError(res.reason ?? "Could not save.");
      else setSaved(true);
    });
  }

  function advance() {
    if (!result?.id) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("result_id", result.id);
    startAdvance(async () => {
      const res = await advanceAfterResults(fd);
      if (!res.ok) setError(res.reason ?? "Could not advance.");
    });
  }

  return (
    <div className="space-y-4">
      {thread.length > 0 && result ? (
        <EntryThread messages={thread} chipTarget="assumption" />
      ) : null}

      <div className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-4 py-3 text-sm">
        <div className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)] mb-2">
          Big Assumption you tested
        </div>
        <div className="italic text-white/90 leading-relaxed">
          {assumption.text}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
          Date you ran the test
        </span>
        <input
          type="date"
          value={ranOn}
          onChange={(e) => setRanOn(e.target.value)}
          disabled={pending}
          className="rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
        />
      </label>

      <Field
        label="So in Order to Test it I Changed my Behavior This Way"
        hint="What you actually did — the concrete move. If plan and reality diverged, say so."
        value={whatIDid}
        onChange={setWhatIDid}
        rows={3}
        disabled={pending}
      />

      <Field
        label="This is What I Observed Happening"
        hint="Observable: what people said and did. Felt: what came up in you. Not interpretations."
        value={dataCollected}
        onChange={setDataCollected}
        rows={4}
        disabled={pending}
      />

      <Field
        label="And This is What it Tells me About my Big Assumption"
        hint="Which aspects of the assumption held? Which didn't? Be specific."
        value={whatItSays}
        onChange={setWhatItSays}
        rows={3}
        disabled={pending}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
            Verdict
          </span>
          <select
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as ItcAssumptionVerdict)}
            disabled={pending}
            className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
          >
            <option value="held">Held — evidence was belief-consistent</option>
            <option value="partially_challenged">
              Partially challenged — some evidence didn't fit
            </option>
            <option value="challenged">
              Challenged — evidence clearly didn't fit
            </option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
            Next step
          </span>
          <select
            value={nextStep}
            onChange={(e) => setNextStep(e.target.value as ItcNextStep)}
            disabled={pending}
            className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
          >
            <option value="new_test">Another test on this same assumption</option>
            <option value="new_assumption">
              A different assumption from the map
            </option>
            <option value="map_complete">Close the map for now</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={pending || advancing}
          className="rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Saving…" : saved ? "Save changes" : "Save debrief"}
        </button>
        {saved && result?.id ? (
          <button
            type="button"
            onClick={advance}
            disabled={pending || advancing}
            className="rounded-md border border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/[0.15] px-4 py-2 text-sm text-white hover:bg-[color:var(--color-primary)]/[0.25] disabled:opacity-50"
            title={nextStepButtonTitle(nextStep)}
          >
            {advancing
              ? "Advancing…"
              : nextStepButtonLabel(nextStep)}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function nextStepButtonLabel(nextStep: ItcNextStep): string {
  switch (nextStep) {
    case "new_test":
      return "Design another test on this assumption →";
    case "new_assumption":
      return "Pick a different assumption →";
    case "map_complete":
      return "Close the map →";
  }
}

function nextStepButtonTitle(nextStep: ItcNextStep): string {
  switch (nextStep) {
    case "new_test":
      return "Back to test design with the same assumption selected";
    case "new_assumption":
      return "Back to prioritize with the picker + test history";
    case "map_complete":
      return "Advance to Done";
  }
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
