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
import { advanceAfterResults, saveTestResult, supersedeTest } from "../actions";
import { EntryThread } from "./entry-thread";
import { FormErrorSummary, FormField } from "./form-field";

/**
 * Results form — the coachee's post-test debrief. Kegan/Lahey four
 * field labels verbatim (Big Assumption you tested is context above
 * the form; three narrative fields to fill; two operational picks —
 * verdict + next step). Save fires reviewTestResult LLM; coach's
 * Kegan-voice interpretation lands as an entry_thread on the result
 * row. Successful save also marks the linked tracker mission
 * completed (server-side; see tracker-link.ts).
 *
 * Validation: per-field pre-flight before submit. Empty required
 * fields highlight with a red border + inline hint. A generic error
 * only surfaces if the server rejects for a reason the client
 * couldn't predict.
 */

/** Field IDs used as keys in the per-field error map. */
type ResultsFieldKey = "what_i_did" | "data_collected" | "what_it_says";
type FieldErrors = Partial<Record<ResultsFieldKey, string>>;

/** Pure client-side validator. Mirrors the server-side zod schema in
 *  actions.ts:saveTestResultSchema (min 3 chars per text field) so the
 *  coachee gets specific per-field feedback instead of a generic
 *  server-side rejection. */
function validateResults(input: {
  whatIDid: string;
  dataCollected: string;
  whatItSays: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (input.whatIDid.trim().length < 3) {
    errors.what_i_did = "Say what you actually did — one specific move.";
  }
  if (input.dataCollected.trim().length < 3) {
    errors.data_collected =
      "Write down what you saw: what people said and did, what came up in you.";
  }
  if (input.whatItSays.trim().length < 3) {
    errors.what_it_says =
      "One line on what the observations say about the assumption.";
  }
  return errors;
}

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
  const [superseding, startSupersede] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState<boolean>(Boolean(result?.what_i_did));

  const snapshot = test.assumption_text_at_design?.trim() ?? null;
  const current = assumption.text.trim();
  const assumptionDrifted =
    snapshot !== null && snapshot.length > 0 && snapshot !== current;

  function onSupersede() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("test_id", test.id);
    startSupersede(async () => {
      const res = await supersedeTest(fd);
      if (!res.ok) setError(res.reason ?? "Could not supersede.");
    });
  }

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
    const errors = validateResults({ whatIDid, dataCollected, whatItSays });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // Also set a summary so screen readers pick it up via the
      // aria-live region below.
      const count = Object.keys(errors).length;
      setError(
        count === 1
          ? "One field needs your attention below."
          : `${count} fields need your attention below.`,
      );
      return;
    }
    setFieldErrors({});
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

  /** Clear a specific field's error the moment the user starts
   *  typing in it — so the red state doesn't linger after they've
   *  started fixing the problem. */
  function clearFieldError(key: ResultsFieldKey) {
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  return (
    <div className="space-y-4">
      {thread.length > 0 && result ? (
        <EntryThread messages={thread} chipTarget="assumption" />
      ) : null}

      {assumptionDrifted ? (
        <div className="rounded-md border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/[0.08] px-4 py-3 space-y-3 text-sm">
          <div className="text-xs uppercase tracking-widest text-[color:var(--color-warning)]">
            The assumption has moved since you designed this test
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--color-text-muted)] mb-1">
              Assumption at test time
            </div>
            <div className="italic text-white/80 leading-relaxed">
              {snapshot}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--color-text-muted)] mb-1">
              Current assumption
            </div>
            <div className="italic text-white/90 leading-relaxed">
              {current}
            </div>
          </div>
          <button
            type="button"
            onClick={onSupersede}
            disabled={superseding || pending || advancing}
            className="rounded-md border border-[color:var(--color-warning)]/60 px-3 py-1.5 text-xs font-semibold text-[color:var(--color-warning)] hover:bg-[color:var(--color-warning)]/10 disabled:opacity-50"
          >
            {superseding ? "…" : "Mark superseded, design new test"}
          </button>
        </div>
      ) : (
        <div className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)] mb-2">
            Big Assumption you tested
          </div>
          <div className="italic text-white/90 leading-relaxed">
            {assumption.text}
          </div>
        </div>
      )}

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

      <FormField
        step={1}
        label="So in Order to Test it I Changed my Behavior This Way"
        hint="What you actually did. The concrete move. If plan and reality diverged, say so."
        value={whatIDid}
        onChange={(v) => {
          setWhatIDid(v);
          clearFieldError("what_i_did");
        }}
        rows={3}
        disabled={pending}
        placeholder="e.g. Tuesday when she brought up the credit card, I stayed in the room instead of leaving. Let her finish."
        error={fieldErrors.what_i_did}
      />

      <FormField
        step={2}
        label="This is What I Observed Happening"
        hint="Observable: what people said and did. Felt: what came up in you. Not interpretations."
        value={dataCollected}
        onChange={(v) => {
          setDataCollected(v);
          clearFieldError("data_collected");
        }}
        rows={4}
        disabled={pending}
        placeholder={`Observable: what they said, what they did, how it ended. The videotape version.\n\nFelt: what came up in you while it was happening.`}
        error={fieldErrors.data_collected}
      />

      <FormField
        step={3}
        label="And This is What it Tells me About my Big Assumption"
        hint="Which aspects of the assumption held? Which didn't? Be specific."
        value={whatItSays}
        onChange={(v) => {
          setWhatItSays(v);
          clearFieldError("what_it_says");
        }}
        rows={3}
        disabled={pending}
        placeholder="Which parts of the assumption's prediction actually held? Which didn't? Be specific about what you saw."
        error={fieldErrors.what_it_says}
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
            <option value="held">Held</option>
            <option value="partially_challenged">Partially challenged</option>
            <option value="challenged">Challenged</option>
          </select>
          <span className="block text-[11px] text-[color:var(--color-text-muted)]/80 italic">
            {verdict === "held"
              ? "The evidence supported the assumption."
              : verdict === "partially_challenged"
                ? "Some of the evidence didn't fit."
                : "The evidence clearly didn't fit."}
          </span>
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

      <FormErrorSummary error={error} />
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

