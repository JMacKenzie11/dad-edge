"use client";

import { useState, useTransition } from "react";
import type { SmartReview } from "@/lib/itc/coach";
import type {
  ItcAssumption,
  ItcMessage,
  ItcTest,
  ItcTestType,
} from "@/lib/itc/maps";
import {
  abandonInFlightTest,
  regenerateTestDraft,
  reviseTestFromCoach,
  runTest,
} from "../actions";
import { AutoTextarea } from "./auto-textarea";
import { EntryThread } from "./entry-thread";
import { useConfirm } from "./use-confirm";

/**
 * Feature flag. The "Give me a safer version" toolbar button is hidden
 * behind this flag while we try the SMART-driven "Have the coach revise
 * this" path (which subsumes the safer-version affordance for the case
 * where a test fails on safety/modesty). Flip to true if we want the
 * pre-run safer path back — the underlying server-side SAFER_LADDER is
 * still wired. See the discussion in the ITC commit that introduced
 * reviseTestFromCoach for the UX rationale.
 */
const SHOW_SAFER_BUTTON = false;

/**
 * Test design form. Renders three of the four Kegan/Lahey worksheet
 * fields (So I Will / And Collect the Following Data / In Order to
 * Find Out Whether) plus test_type + target_date. The fourth field
 * (My Big Assumption Says) is not surfaced — it's always in sync
 * with the live assumption text, shown in the "Testing this
 * assumption" panel above. See the note at the top of the component
 * function for the rationale.
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
  const [regenPending, startRegen] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  // Latest SMART review from Run the Test. Held in client state only —
  // not persisted server-side. Populated on needs_work; on ready we've
  // already advanced (form unmounts) so it never displays. Cleared on
  // regenerate/type-change since the form is now a fresh draft.
  const [latestReview, setLatestReview] = useState<SmartReview | null>(null);
  const [testType, setTestType] = useState<ItcTestType>(
    test?.test_type ?? "behavioral",
  );
  // assumption_says intentionally NOT surfaced as an editable field.
  // Previously it was a snapshot the coach could "sharpen with the
  // prediction" but that snapshot went stale the moment the coachee
  // edited the assumption on Column 5, and it duplicated the intent
  // that in_order_to_find_out already carries. The "Testing this
  // assumption" panel below shows the live assumption text; every
  // write below force-syncs assumption_says to assumption.text so
  // legacy readers (test row, coach helpers, admin view) see the
  // current text without a per-write manual field.
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

  /**
   * Fires the LLM to produce a new draft (initial / another / safer)
   * and updates form state with the returned slots. Does NOT touch
   * the DB — the coachee still has to click Save to persist. This
   * lets them freely regenerate variants until they find one they
   * want. If they've made unsaved edits, a confirm dialog protects
   * against blowing them away.
   */
  /**
   * Fires the LLM to produce a new draft. For "another" and "safer"
   * the server rotates / steps the type — client sends the CURRENT
   * type and mode, server derives the target type deterministically
   * (see actions.ts ANOTHER_ROTATION / SAFER_LADDER). No prompt-
   * shaping instructions for variation — variation is architectural.
   */
  async function regenerate(mode: "initial" | "another" | "safer") {
    const hasEdits =
      (test?.behavior_change ?? "") !== behaviorChange ||
      (test?.data_to_collect ?? "") !== dataToCollect ||
      (test?.in_order_to_find_out ?? "") !== inOrderToFindOut;
    if (hasEdits) {
      const confirmLabel =
        mode === "safer"
          ? "Get safer version"
          : mode === "another"
            ? "Get another draft"
            : "Change type";
      const ok = await confirm({
        title: "Replace your current edits?",
        body: "You'll lose the changes you've made to the fields.",
        confirmLabel,
        destructive: true,
      });
      if (!ok) return;
    }
    fireRegenerate(mode, testType);
  }

  async function onTypeChange(newType: ItcTestType) {
    if (newType === testType) return;
    const hasEdits =
      (test?.behavior_change ?? "") !== behaviorChange ||
      (test?.data_to_collect ?? "") !== dataToCollect ||
      (test?.in_order_to_find_out ?? "") !== inOrderToFindOut;
    if (hasEdits) {
      const ok = await confirm({
        title: "Change test type and start over?",
        body: "You'll lose the changes you've made to the fields.",
        confirmLabel: "Change type",
        destructive: true,
      });
      if (!ok) return;
    }
    setTestType(newType);
    fireRegenerate("initial", newType);
  }

  /**
   * Shared regenerate dispatcher. Extracted so the confirm-edits
   * dialog can be reused from both button-driven regenerates and
   * the type-dropdown-change path.
   */
  function fireRegenerate(
    mode: "initial" | "another" | "safer",
    typeToSend: ItcTestType,
  ) {
    setError(null);
    setLatestReview(null); // a new draft is a fresh test — old SMART verdict no longer applies
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("test_type", typeToSend);
    fd.set("mode", mode);
    startRegen(async () => {
      const res = await regenerateTestDraft(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not get a new draft.");
        return;
      }
      // Update local form state; user still has to Save to persist.
      setTestType(res.draft.testType);
      setBehaviorChange(res.draft.behaviorChange);
      setDataToCollect(res.draft.dataToCollect);
      setInOrderToFindOut(res.draft.inOrderToFindOut);
      setTargetDate(res.draft.targetDate);
    });
  }

  // Data mining is the safest test type — nothing to step down to.
  // Client hides "Give me a safer version" in that state so the
  // coachee doesn't hit an error dialog.
  const canGoSafer = testType !== "data_mining";

  /**
   * "Have the coach revise this" — fired from the SmartReviewCard when
   * verdict is needs_work. Sends the current on-screen form fields
   * (not the DB row — coachee may have edited without saving) plus
   * the SMART review payload to the server. Coach returns revised
   * slots targeted at the failed criteria; client updates form state
   * and clears the SMART card (the revision is a new test that needs
   * a fresh review on the next Run the Test).
   */
  function reviseFromCoach() {
    if (!latestReview) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("test_type", testType);
    // Always send the LIVE assumption text — never a snapshot. See
    // the note on assumption_says at the top of this component.
    fd.set("assumption_says", assumption.text);
    fd.set("behavior_change", behaviorChange.trim());
    fd.set("data_to_collect", dataToCollect.trim());
    fd.set("in_order_to_find_out", inOrderToFindOut.trim());
    fd.set("target_date", targetDate);
    fd.set("review_json", JSON.stringify(latestReview));
    startRegen(async () => {
      const res = await reviseTestFromCoach(fd);
      if (!res.ok) {
        setError(res.reason ?? "Coach couldn't revise.");
        return;
      }
      setTestType(res.draft.testType);
      setBehaviorChange(res.draft.behaviorChange);
      setDataToCollect(res.draft.dataToCollect);
      setInOrderToFindOut(res.draft.inOrderToFindOut);
      setTargetDate(res.draft.targetDate);
      // Server ran the self-verify loop and returns the SMART verdict
      // of the FINAL revision. If ready: SMART card flips to green.
      // If still needs_work (rare — retry cap hit): fresh feedback
      // for the next round. If null (review LLM failed): clear the
      // stale card; coachee can hit Run the Test to re-score.
      setLatestReview(res.review);
    });
  }

  /**
   * Single-button flow: save this design + fire SMART review + if
   * verdict is "ready" (or the review LLM failed), advance to
   * test_running in the same round-trip. On "needs_work" we stay
   * put — the review lands in the entry thread above the form and
   * the coachee tightens what was flagged. See actions.ts runTest.
   */
  function runIt() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    if (test?.id) fd.set("test_id", test.id);
    fd.set("assumption_id", assumption.id);
    fd.set("test_type", testType);
    // Always send the LIVE assumption text — never a snapshot. See
    // the note on assumption_says at the top of this component.
    fd.set("assumption_says", assumption.text);
    fd.set("behavior_change", behaviorChange.trim());
    fd.set("data_to_collect", dataToCollect.trim());
    fd.set("in_order_to_find_out", inOrderToFindOut.trim());
    fd.set("target_date", targetDate);
    startTransition(async () => {
      const res = await runTest(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not save test.");
        return;
      }
      // If advanced === true, the server revalidated the page and
      // this form is about to unmount (map moved to test_running).
      // If advanced === false, we stay on test_design and render
      // the SMART card from res.review at the top of the form.
      if (!res.advanced) {
        setLatestReview(res.review);
      }
    });
  }

  async function goBackToPrioritize() {
    if (!test?.id) {
      // No test to abandon — coachee just navigates back. In practice
      // this shouldn't happen (server pre-drafts on advance) but
      // handle it gracefully.
      window.location.reload();
      return;
    }
    const ok = await confirm({
      title: "Test a different assumption?",
      body: "Your current design will be marked abandoned but preserved in history.",
      confirmLabel: "Test a different one",
      destructive: true,
    });
    if (!ok) return;
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
      {confirmDialog}
      {thread.length > 0 && test ? (
        <EntryThread messages={thread} chipTarget="assumption" />
      ) : null}

      {latestReview ? (
        <SmartReviewCard
          review={latestReview}
          onRevise={reviseFromCoach}
          revising={regenPending}
        />
      ) : null}

      <div className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-4 py-3 text-sm">
        <div className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)] mb-2">
          Testing this assumption
        </div>
        <div className="italic text-white/90 leading-relaxed">
          {assumption.text}
        </div>
      </div>

      {/* Type dropdown at the top — the whole test shape hinges on
          type. Changing it fires a re-draft (see onTypeChange). */}
      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
          Type of test
        </span>
        <select
          value={testType}
          onChange={(e) => onTypeChange(e.target.value as ItcTestType)}
          disabled={pending || regenPending}
          className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
        >
          <option value="behavioral">Behavioral (do something different in real life)</option>
          <option value="observation">Observation (watch, don't act)</option>
          <option value="data_mining">Data mining (look at what's already happened)</option>
          <option value="thought_experiment">Thought experiment (imagine, don't act)</option>
        </select>
        <span className="block text-[11px] text-[color:var(--color-text-muted)]/70 italic">
          Changing the type gets you a fresh draft of that kind.
        </span>
      </label>

      {/* Regenerate row — sit right under the type dropdown so the
          coachee sees the "get another draft" affordances at the top
          of the form, not buried after the fields. Safer button is
          hidden when the coachee is already at data_mining (nothing
          to step down to). */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => regenerate("another")}
          disabled={pending || regenPending}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-2 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          title="Ask the coach for a different kind of test on the same assumption"
        >
          Give me another draft
        </button>
        {SHOW_SAFER_BUTTON && canGoSafer ? (
          <button
            type="button"
            onClick={() => regenerate("safer")}
            disabled={pending || regenPending}
            className="rounded-md border border-[color:var(--color-border)] px-3 py-2 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
            title="Ask the coach for a lower-stakes version of this test"
          >
            Give me a safer version
          </button>
        ) : null}
        {regenPending ? (
          <span className="flex items-center gap-2 text-xs text-[color:var(--color-primary)]/90">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--color-primary)]/40 border-t-[color:var(--color-primary)]" />
            The coach is writing a new draft…
          </span>
        ) : null}
      </div>

      {/* Form fields — dim + block interaction during regeneration
          so the coachee can visibly see the draft is being replaced. */}
      <div
        className={
          "space-y-3 transition-opacity " +
          (regenPending ? "opacity-40 pointer-events-none" : "")
        }
      >
        <Field
          label="So I Will (Change my Behavior This Way)"
          hint="One specific move in one specific moment. Modest. Worst case must be livable."
          value={behaviorChange}
          onChange={setBehaviorChange}
          rows={2}
          disabled={pending || regenPending}
        />

        <Field
          label="And Collect the Following Data"
          hint="Observable (what would show up on a videotape) + felt. Not interpretive."
          value={dataToCollect}
          onChange={setDataToCollect}
          rows={2}
          disabled={pending || regenPending}
        />

        <Field
          label="In Order to Find Out Whether"
          hint="What would tell you the assumption doesn't hold. Name the disconfirmation."
          value={inOrderToFindOut}
          onChange={setInOrderToFindOut}
          rows={2}
          disabled={pending || regenPending}
        />

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
            Target date
          </span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            disabled={pending || regenPending}
            className="rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={runIt}
          disabled={pending || regenPending}
          className="rounded-md bg-[color:var(--color-primary)] px-4 py-3 text-base font-semibold disabled:opacity-50"
          title="Save this design; the coach reviews it against SMART. If it clears, you'll advance to running the test. If not, you'll see what to tighten."
        >
          {pending ? "…" : "Run the Test"}
        </button>
        <button
          type="button"
          onClick={goBackToPrioritize}
          disabled={pending || regenPending}
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
      <AutoTextarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minRows={rows}
        disabled={disabled}
        className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm leading-relaxed"
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

/**
 * The SMART verdict card, rendered when runTest returns needs_work.
 * All layout / iconography lives here — the LLM never writes
 * markdown or checkmarks. Each criterion gets a row with a real
 * icon + label + coach's one-sentence note grounded in the test.
 * needs_work gets an amber border + "One thing to tighten" callout;
 * ready gets a green border (though in practice ready cases advance
 * and this component never displays them — kept for completeness).
 */
function SmartReviewCard({
  review,
  onRevise,
  revising,
}: {
  review: SmartReview;
  /** Called when the coachee clicks "Have the coach revise this".
   *  Undefined disables the button — used when the parent doesn't
   *  want the affordance (e.g., a future read-only surface). */
  onRevise?: () => void;
  /** Parent's regenerate-in-flight signal. Disables the button and
   *  swaps its label to a "working…" state. */
  revising?: boolean;
}) {
  const isReady = review.verdict === "ready";
  const rows: Array<{ key: string; label: string; pass: boolean; note: string }> = [
    { key: "safe", label: "Safe", pass: review.smart.safe.pass, note: review.smart.safe.note },
    { key: "modest", label: "Modest", pass: review.smart.modest.pass, note: review.smart.modest.note },
    {
      key: "actionable",
      label: "Actionable this week",
      pass: review.smart.actionable.pass,
      note: review.smart.actionable.note,
    },
    {
      key: "researches",
      label: "Researches the assumption",
      pass: review.smart.researches.pass,
      note: review.smart.researches.note,
    },
    {
      key: "counters_assumption",
      label: "Counters the assumption",
      pass: review.smart.counters_assumption.pass,
      note: review.smart.counters_assumption.note,
    },
  ];
  const borderClass = isReady
    ? "border-emerald-500/60 bg-emerald-500/[0.06]"
    : "border-amber-500/60 bg-amber-500/[0.06]";
  const badgeClass = isReady
    ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
    : "bg-amber-500/20 text-amber-100 border border-amber-500/40";
  return (
    <div className={`rounded-md border-2 ${borderClass} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${badgeClass}`}
        >
          {isReady ? "Ready to run" : "Not ready yet"}
        </span>
        <span className="text-[11px] uppercase tracking-widest text-[color:var(--color-text-muted)]">
          Coach review
        </span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-2.5 text-sm leading-relaxed">
            <span
              className={
                "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                (row.pass
                  ? "bg-emerald-500/25 text-emerald-200"
                  : "bg-red-500/30 text-red-100")
              }
              aria-hidden="true"
            >
              {row.pass ? "✓" : "✗"}
            </span>
            <span>
              <span className="font-semibold text-white">{row.label}</span>
              <span className="text-[color:var(--color-text-muted)]">: {row.note}</span>
            </span>
          </li>
        ))}
      </ul>
      {!isReady && review.one_thing_to_tighten ? (
        <div className="rounded-md border border-amber-500/40 bg-black/30 px-3 py-2 text-sm">
          <div className="text-[11px] uppercase tracking-widest text-amber-200/90 mb-1 font-semibold">
            One thing to tighten
          </div>
          <div className="text-white/90 leading-relaxed">
            {review.one_thing_to_tighten}
          </div>
        </div>
      ) : null}
      {!isReady && onRevise ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRevise}
            disabled={revising}
            className="rounded-md border border-amber-500/60 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
            title="Let the coach rewrite the test to address the criterion that failed"
          >
            {revising ? "The coach is revising…" : "Have the coach revise this"}
          </button>
          <span className="text-xs text-[color:var(--color-text-muted)]/80">
            or edit the fields yourself and hit Run the Test again
          </span>
        </div>
      ) : null}
    </div>
  );
}
