"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useCurrentHelpView } from "@/components/help/current-view-context";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcAssumptionDraft,
  ItcBehavior,
  ItcCommitment,
  ItcMap,
  ItcMessage,
  ItcTest,
  ItcTestResult,
  ItcWorry,
} from "@/lib/itc/maps";
import { chipTargetForStage, type ChipTarget } from "@/lib/itc/chip-target";
import { stageIndex, type ItcStage } from "@/lib/itc/stage";
import { isLegacyCannedIntro, STAGE_INTROS } from "@/lib/itc/stage-intros";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { advanceToStage, type AdvanceGate } from "../actions";
import { AssumptionsRow } from "./assumptions-row";
import { BehaviorsRow } from "./behaviors-row";
import { ImmuneSystemDiagram } from "./immune-system-diagram";
import { RegenerateWalkthroughButton } from "./regenerate-walkthrough-button";
import { CommitmentsRow } from "./commitments-row";
import { EntryThread } from "./entry-thread";
import { GoalRow } from "./goal-row";
import { PrioritizePicker } from "./prioritize-picker";
import { ResultsForm } from "./results-form";
import { TestDesignForm } from "./test-design-form";
import { WorriesRow } from "./worries-row";
import { HoneButton } from "./hone-button";
import { HoneDiagnosticBanner } from "./hone-diagnostic-banner";

const TEST_TYPE_LABELS: Record<ItcTest["test_type"], string> = {
  data_mining: "Data mining",
  observation: "Self-observation",
  thought_experiment: "Thought experiment",
  behavioral: "Behavioral",
};

const FRESH_ROW_MS = 15_000;
function isFresh(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

/**
 * Full-width single-column canvas per Layout Amendment §1. Rows are
 * stacked; the active section shows its stage note pinned at top,
 * its input controls, its entry threads, and the Continue button
 * that advances to the next section.
 */
export function MapCanvas({
  map,
  behaviors,
  worries,
  commitments,
  assumptions,
  assumptionLinks,
  assumptionDrafts,
  tests,
  testResults,
  messages,
  advanceGate,
}: {
  map: ItcMap;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
  assumptionLinks: ItcAssumptionCommitment[];
  assumptionDrafts: ItcAssumptionDraft[];
  tests: ItcTest[];
  testResults: ItcTestResult[];
  messages: ItcMessage[];
  advanceGate: AdvanceGate;
}) {
  const renderedAt = Date.now();
  const pillar = PILLAR_BY_CODE[map.pillar_code];

  // Publish the active stage to the CurrentHelpView context so the
  // global Help widget can serve stage-specific content. The URL
  // doesn't change between stages, so without this signal the
  // widget would serve the same content on every stage of an ITC
  // map.
  const { setCurrentView } = useCurrentHelpView();
  useEffect(() => {
    setCurrentView(map.current_stage);
    return () => setCurrentView(null);
  }, [map.current_stage, setCurrentView]);

  // Group messages by surface + anchor for fast per-entry lookup.
  //
  // Compatibility fallback: the layout amendment introduced `surface`
  // and `entry_ref_*` columns on itc_messages via migration. Until
  // that migration lands on the hosted DB, inserts drop those
  // columns silently and messages come back with them null. To keep
  // the coach visible during rollout:
  //   - null-surface assistant messages on the current stage render
  //     as stage-note-adjacent "coach notes" in the active section
  //     via unattachedFor().
  //   - dock messages still filter to surface==="dock" only (safe:
  //     if the column is missing they're invisible until migration,
  //     but the dock drawer just shows empty).
  const stageNotes = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.surface === "stage_note" &&
          m.stage_at_creation === map.current_stage,
      ),
    [messages, map.current_stage],
  );
  // The immune-system walkthrough is stored as a stage_note with
  // stage_at_creation=immune_system when deliverWalkthroughAfterAdvance
  // fires. It stays visible on the immune_system section indefinitely
  // (unlike other sections' stage_notes which filter to current_stage),
  // so the coachee can re-read it later when they're at prioritize or
  // beyond.
  const immuneSystemNotes = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.surface === "stage_note" &&
          m.stage_at_creation === "immune_system",
      ),
    [messages],
  );
  // Prioritize stage_notes — same always-visible pattern as the
  // walkthrough. Only the MOST RECENT one renders: on second visits
  // (after a test cycle with next_step=new_assumption), the
  // recommendation regenerates against the updated test history and
  // the previous recommendation is stale (may still reference an
  // assumption that's already been tested). Filter to the freshest.
  const prioritizeNotes = useMemo(() => {
    const all = messages.filter(
      (m) =>
        m.surface === "stage_note" &&
        m.stage_at_creation === "prioritize",
    );
    if (all.length === 0) return all;
    return [all[all.length - 1]];
  }, [messages]);
  // Done stage_notes — the closing summary. Always visible once the
  // coachee has reached done. Same pattern as immune_system +
  // prioritize.
  const doneNotes = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.surface === "stage_note" && m.stage_at_creation === "done",
      ),
    [messages],
  );
  // Whole-map hone audit — only ever one at a time. Rendered as a
  // banner at the top of the canvas via HoneDiagnosticBanner. Deleted
  // by any entry write (see invalidateReviewsForColumn) and by the
  // banner's Dismiss button. Latest by created_at wins if a race
  // somehow leaves two.
  const honeDiagnostic = useMemo(() => {
    const all = messages.filter((m) => m.surface === "hone_diagnostic");
    if (all.length === 0) return null;
    return all.reduce((latest, m) =>
      new Date(m.created_at) > new Date(latest.created_at) ? m : latest,
    );
  }, [messages]);
  // End-of-column review messages, keyed by the stage they audit.
  // Only ever one per stage (deleteColumnReviewMessages wipes prior
  // rows on any entry save so the audit always reflects fresh state).
  // Rendered inside the matching Section above the coachee's own
  // Continue button.
  const columnReviewByStage = useMemo(() => {
    const byStage = new Map<ItcStage, ItcMessage>();
    for (const m of messages) {
      if (m.surface !== "column_review") continue;
      byStage.set(m.stage_at_creation, m);
    }
    return byStage;
  }, [messages]);
  // dockMessages removed with the CoachDock (2026-08-24). Historical
  // dock messages remain in the DB for audit / turn-event context but
  // no surface renders them anymore.
  const threadsByAnchor = useMemo(() => {
    const grouped = new Map<string, ItcMessage[]>();
    for (const m of messages) {
      if (m.surface !== "entry_thread") continue;
      if (!m.entry_ref_table || !m.entry_ref_id) continue;
      const key = `${m.entry_ref_table}:${m.entry_ref_id}`;
      const arr = grouped.get(key) ?? [];
      arr.push(m);
      grouped.set(key, arr);
    }
    return grouped;
  }, [messages]);
  // Assistant messages with NO surface set — pre-migration inserts
  // and any client-side downgraded writes. Grouped by stage so we
  // can render them in the correct active section's fallback slot.
  const unattachedByStage = useMemo(() => {
    const grouped = new Map<ItcStage, ItcMessage[]>();
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      if (m.surface != null) continue;
      const arr = grouped.get(m.stage_at_creation) ?? [];
      arr.push(m);
      grouped.set(m.stage_at_creation, arr);
    }
    return grouped;
  }, [messages]);

  const threadFor = (table: string, id: string) =>
    threadsByAnchor.get(`${table}:${id}`) ?? [];
  const unattachedForCurrentStage =
    unattachedByStage.get(map.current_stage) ?? [];

  const liveIntroFor = (stage: ItcStage): string | undefined => {
    if (stage !== map.current_stage) return undefined;
    return STAGE_INTROS[stage]?.({
      goal: map.improvement_goal,
      pillarCode: map.pillar_code,
    });
  };

  // A column is LOCKED when the coachee hasn't advanced into it
  // yet. Past columns stay editable (backward navigation is always
  // allowed under Form-First), only future columns are inaccessible.
  const currentIdx = stageIndex(map.current_stage);
  const isLocked = (rowStage: ItcStage): boolean =>
    stageIndex(rowStage) > currentIdx;

  const worriesByBehavior = new Map(worries.map((w) => [w.behavior_id, w]));
  const selectedBehaviors = behaviors.filter((b) => b.selected);

  // Per-item thread maps for the interleaved layout. Populated only
  // when the corresponding stage is active — non-active stages get
  // empty maps so the row components render inputs without threads
  // (the same "quiet locked column" rule that hides the goal thread
  // when the goal stage isn't active).
  const behaviorThreads = new Map<string, ItcMessage[]>();
  if (map.current_stage === "behaviors") {
    for (const b of selectedBehaviors) {
      const t = threadFor("itc_behaviors", b.id);
      if (t.length > 0) behaviorThreads.set(b.id, t);
    }
  }
  const worryThreads = new Map<string, ItcMessage[]>();
  if (map.current_stage === "worries") {
    for (const w of worries) {
      const t = threadFor("itc_worries", w.id);
      if (t.length > 0) worryThreads.set(w.id, t);
    }
  }
  const commitmentThreads = new Map<string, ItcMessage[]>();
  if (map.current_stage === "commitments") {
    for (const c of commitments) {
      const t = threadFor("itc_commitments", c.id);
      if (t.length > 0) commitmentThreads.set(c.id, t);
    }
  }
  const assumptionThreads = new Map<string, ItcMessage[]>();
  if (map.current_stage === "assumptions") {
    for (const a of assumptions) {
      const t = threadFor("itc_assumptions", a.id);
      if (t.length > 0) assumptionThreads.set(a.id, t);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
            Immunity Map
          </div>
          <div className="text-base">
            Pillar:{" "}
            <span
              className="font-semibold"
              style={{ color: pillar.colorVar }}
            >
              {pillar.label}
            </span>
          </div>
        </div>
        {/* "HONE THIS MAP" trigger. Available past the goal stage
            (nothing to audit until behaviors is at least started).
            Regens the audit each click; label switches to
            "RE-RUN AUDIT" when a diagnostic is already on-screen. */}
        {stageIndex(map.current_stage) > stageIndex("goal") ? (
          <HoneButton
            mapId={map.id}
            hasDiagnostic={honeDiagnostic !== null}
          />
        ) : null}
      </div>

      {honeDiagnostic ? (
        <HoneDiagnosticBanner
          mapId={map.id}
          content={honeDiagnostic.content}
        />
      ) : null}

      <div className="space-y-4">
        <Section
          stage="goal"
          title="1. Improvement goal (Big Commitment)"
          active={map.current_stage === "goal"}
          liveIntro={liveIntroFor("goal")}
          chipTarget={chipTargetForStage(map.current_stage)}
          stageNotes={map.current_stage === "goal" ? stageNotes : []}
          columnReview={columnReviewByStage.get("goal")}
          unattachedCoachNotes={
            map.current_stage === "goal" ? unattachedForCurrentStage : []
          }
        >
          {/* Feedback-above-input: coach reaction on the goal renders
              directly above the input so read-then-edit is adjacent,
              not a scroll-back-up loop. */}
          {map.improvement_goal && map.current_stage === "goal" ? (
            <div className="mb-3">
              <EntryThread
                chipTarget="goal"
                messages={threadFor("itc_maps", map.id).filter(
                  (m) => m.stage_at_creation === "goal",
                )}
                pillarSwitchMapId={map.id}
                currentPillarCode={map.pillar_code}
              />
            </div>
          ) : null}
          <GoalRow
            mapId={map.id}
            goalText={map.improvement_goal}
          />
        </Section>

        {advanceGate && map.current_stage === "goal" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="2. Doing / not-doing"
          stage="behaviors"
          active={map.current_stage === "behaviors"}
          liveIntro={liveIntroFor("behaviors")}
          chipTarget={chipTargetForStage(map.current_stage)}
          stageNotes={map.current_stage === "behaviors" ? stageNotes : []}
          columnReview={columnReviewByStage.get("behaviors")}
          unattachedCoachNotes={
            map.current_stage === "behaviors" ? unattachedForCurrentStage : []
          }
        >
          <BehaviorsRow
            mapId={map.id}
            behaviors={behaviors}
            behaviorIdsWithWorries={
              new Set(worries.map((w) => w.behavior_id))
            }
            nowMs={renderedAt}
            threads={behaviorThreads}
            isLocked={isLocked("behaviors")}
          />
        </Section>

        {advanceGate && map.current_stage === "behaviors" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="3. Worry box"
          stage="worries"
          active={map.current_stage === "worries"}
          liveIntro={liveIntroFor("worries")}
          chipTarget={chipTargetForStage(map.current_stage)}
          stageNotes={map.current_stage === "worries" ? stageNotes : []}
          columnReview={columnReviewByStage.get("worries")}
          unattachedCoachNotes={
            map.current_stage === "worries" ? unattachedForCurrentStage : []
          }
        >
          <WorriesRow
            mapId={map.id}
            behaviors={behaviors}
            worries={worries}
            nowMs={renderedAt}
            threads={worryThreads}
            isLocked={isLocked("worries")}
          />
        </Section>

        {advanceGate && map.current_stage === "worries" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="4. Competing Commitments"
          stage="commitments"
          active={map.current_stage === "commitments"}
          liveIntro={liveIntroFor("commitments")}
          chipTarget={chipTargetForStage(map.current_stage)}
          stageNotes={map.current_stage === "commitments" ? stageNotes : []}
          columnReview={columnReviewByStage.get("commitments")}
          unattachedCoachNotes={
            map.current_stage === "commitments" ? unattachedForCurrentStage : []
          }
        >
          <CommitmentsRow
            mapId={map.id}
            behaviors={behaviors}
            worries={worries}
            commitments={commitments}
            nowMs={renderedAt}
            threads={commitmentThreads}
            isLocked={isLocked("commitments")}
          />
        </Section>

        {advanceGate && map.current_stage === "commitments" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="5. Big Assumptions"
          stage="assumptions"
          active={map.current_stage === "assumptions"}
          liveIntro={liveIntroFor("assumptions")}
          chipTarget={chipTargetForStage(map.current_stage)}
          stageNotes={map.current_stage === "assumptions" ? stageNotes : []}
          columnReview={columnReviewByStage.get("assumptions")}
          unattachedCoachNotes={
            map.current_stage === "assumptions" ? unattachedForCurrentStage : []
          }
        >
          <AssumptionsRow
            mapId={map.id}
            assumptions={assumptions}
            commitments={commitments}
            links={assumptionLinks}
            drafts={
              map.current_stage === "assumptions" ? assumptionDrafts : []
            }
            nowMs={renderedAt}
            threads={assumptionThreads}
            isLocked={isLocked("assumptions")}
          />
        </Section>

        {stageIndex(map.current_stage) >= stageIndex("immune_system") ? (
          <Section
            title="Your immune system"
            stage="immune_system"
            active={map.current_stage === "immune_system"}
            liveIntro={liveIntroFor("immune_system")}
            beforeNotes={
              <ImmuneSystemDiagram
                improvementGoal={map.improvement_goal}
                commitments={commitments}
              />
            }
            stageNotes={immuneSystemNotes}
          >
            {immuneSystemNotes.length > 0 ? (
              <RegenerateWalkthroughButton mapId={map.id} />
            ) : null}
          </Section>
        ) : null}

        {stageIndex(map.current_stage) >= stageIndex("prioritize") ? (
          <Section
            title="Which assumption to test first"
            stage="prioritize"
            active={map.current_stage === "prioritize"}
            stageNotes={prioritizeNotes}
          >
            {assumptions.length > 0 ? (
              <PrioritizePicker
                mapId={map.id}
                assumptions={assumptions}
                tests={tests}
                results={testResults}
              />
            ) : null}
          </Section>
        ) : null}

        {stageIndex(map.current_stage) >= stageIndex("test_design") ? (
          <Section
            title="Design the test"
            stage="test_design"
            active={map.current_stage === "test_design"}
            liveIntro={liveIntroFor("test_design")}
            stageNotes={
              map.current_stage === "test_design" ? stageNotes : []
            }
          >
            {(() => {
              const activeAssumption =
                assumptions.find((a) => a.selected_for_testing) ?? null;
              const activeTest =
                tests
                  .slice()
                  .reverse()
                  .find((t) => t.status !== "abandoned") ?? null;
              if (!activeAssumption) {
                return (
                  <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
                    Pick an assumption to test first from your Big Assumptions above.
                  </p>
                );
              }
              const testThread =
                activeTest
                  ? threadsByAnchor.get(`itc_tests:${activeTest.id}`) ?? []
                  : [];
              return (
                <TestDesignForm
                  mapId={map.id}
                  test={activeTest}
                  assumption={activeAssumption}
                  thread={testThread}
                />
              );
            })()}
          </Section>
        ) : null}

        {stageIndex(map.current_stage) >= stageIndex("test_running") ? (
          <Section
            title="Run the test"
            stage="test_running"
            active={map.current_stage === "test_running"}
            liveIntro={liveIntroFor("test_running")}
            stageNotes={
              map.current_stage === "test_running" ? stageNotes : []
            }
          >
            {(() => {
              const activeTest =
                tests
                  .slice()
                  .reverse()
                  .find((t) => t.status !== "abandoned") ?? null;
              if (!activeTest) {
                return (
                  <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
                    Save a test design first.
                  </p>
                );
              }
              // Compact "reminder" — just the move + target date.
              // The full four fields live in the test-design section
              // above; the coachee can scroll back if they need them.
              // Repeating all four here reads as duplication.
              return (
                <div className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-4 py-3 text-sm space-y-2">
                  {activeTest.behavior_change ? (
                    <div>
                      <div className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)] mb-1">
                        Your move
                      </div>
                      <div className="italic text-white/90 leading-relaxed">
                        {activeTest.behavior_change}
                      </div>
                    </div>
                  ) : null}
                  {activeTest.target_date ? (
                    <div className="text-xs text-[color:var(--color-text-muted)] pt-1">
                      Target date: {activeTest.target_date}
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </Section>
        ) : null}

        {stageIndex(map.current_stage) >= stageIndex("results") ? (
          <Section
            title="Debrief the test"
            stage="results"
            active={map.current_stage === "results"}
            liveIntro={liveIntroFor("results")}
            stageNotes={
              map.current_stage === "results" ? stageNotes : []
            }
          >
            {(() => {
              const activeTest =
                tests
                  .slice()
                  .reverse()
                  .find((t) => t.status !== "abandoned") ?? null;
              const activeAssumption = activeTest
                ? assumptions.find((a) => a.id === activeTest.assumption_id) ??
                  null
                : null;
              const activeResult = activeTest
                ? testResults
                    .slice()
                    .reverse()
                    .find((r) => r.test_id === activeTest.id) ?? null
                : null;
              if (!activeTest || !activeAssumption) {
                return (
                  <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
                    Run a test first.
                  </p>
                );
              }
              const resultThread =
                activeResult
                  ? threadsByAnchor.get(
                      `itc_test_results:${activeResult.id}`,
                    ) ?? []
                  : [];
              return (
                <ResultsForm
                  mapId={map.id}
                  test={activeTest}
                  assumption={activeAssumption}
                  result={activeResult}
                  thread={resultThread}
                />
              );
            })()}
          </Section>
        ) : null}

        {map.current_stage === "done" ? (
          <Section
            stage="done"
            title="Closing the map"
            active
            stageNotes={doneNotes}
          />
        ) : null}
      </div>

      {advanceGate &&
      (map.current_stage === "assumptions" ||
        map.current_stage === "review" ||
        map.current_stage === "immune_system" ||
        map.current_stage === "prioritize" ||
        map.current_stage === "test_running") ? (
        <ContinueBar mapId={map.id} gate={advanceGate} />
      ) : null}
      {/* test_design uses the TestDesignForm's own "Run the Test" button
          — save + SMART review + advance-if-ready are one action. The
          generic ContinueBar hides for that stage. */}
      {/* results stage uses the ResultsForm's own advance buttons
          (routed via next_step: design another test / pick a
          different assumption / close the map). Generic ContinueBar
          would conflict — hidden here. */}

      {/* TestsPanel removed — the per-stage Sections (Design the test /
          Run the test / Debrief the test) render the same information
          in a less cramped layout, and the panel's inline label-value
          rows were showing up as visually crushed. History browsing
          for multi-cycle tests can come back as a dedicated affordance
          later if needed. */}

      {/* CoachDock removed 2026-08-24. The global Help widget mounted
          via the ITC layout occupies this visual slot; there is no
          free-form Q&A anywhere in this system. See
          docs/DECISIONS.md → Context-Aware Help System. */}
    </div>
  );
}

function Section({
  title,
  children,
  active = false,
  stage,
  liveIntro,
  beforeNotes,
  stageNotes,
  columnReview,
  unattachedCoachNotes = [],
  chipTarget,
}: {
  title: string;
  /** Optional — the immune-system section has no user input, its
   *  content IS the walkthrough delivered as a stage_note. */
  children?: React.ReactNode;
  active?: boolean;
  /** Stage this section represents. Rendered as an id
   *  ("stage-section-{stage}") so the CurrentStageBroadcaster can
   *  scroll to the newly-active section after an advance. Optional
   *  because a few historical / one-off sections don't map to a
   *  stage. */
  stage?: ItcStage;
  /** Live-interpolated stage intro rendered above stored stage notes.
   *  Comes from STAGE_INTROS with the current map state so quotes of
   *  the goal etc. always reflect present values, not a stale snapshot. */
  liveIntro?: string;
  /** Optional block rendered between the liveIntro and the stage
   *  notes — e.g. the immune-system diagram, which orients the coachee
   *  visually before he reads the narrative. */
  beforeNotes?: React.ReactNode;
  stageNotes: ItcMessage[];
  /** End-of-column coach audit rendered below the section's inputs,
   *  above the Continue button. Only shown on the active section (the
   *  audit is only useful in-context). */
  columnReview?: ItcMessage;
  /** Fallback: assistant messages on this stage with no surface set.
   *  Rendered as stage-note-styled coach notes so the coach's reply
   *  is visible even when the migration adding surface/entry_ref
   *  hasn't been applied yet. Only shown on the active section. */
  unattachedCoachNotes?: ItcMessage[];
  /** Which input a chip tap in this section should fill. Undefined
   *  on non-active sections (chips only render on active). */
  chipTarget?: ChipTarget;
}) {
  // Legacy canned intros used to be persisted with a goal snapshot
  // baked in. Filter them out so the live-interpolated intro is the
  // only version the user sees.
  const filteredNotes = stageNotes.filter((m) => !isLegacyCannedIntro(m.content));
  const notesToShow = active
    ? [...filteredNotes, ...unattachedCoachNotes]
    : filteredNotes;
  return (
    <section
      id={stage ? `stage-section-${stage}` : undefined}
      // scroll-mt matches the AppHeader sticky height (h-24 = 6rem)
      // so scrollIntoView / anchor navigation lands the section
      // title below the header instead of behind it.
      className={
        "scroll-mt-24 rounded-[var(--radius-card)] border bg-[color:var(--color-surface)] p-5 " +
        (active
          ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/[0.04]"
          : "border-[color:var(--color-primary)]/25")
      }
    >
      <h3
        className={
          "text-xs uppercase tracking-widest mb-3 " +
          (active
            ? "text-[color:var(--color-primary)] font-semibold"
            : "text-[color:var(--color-text-muted)]")
        }
      >
        {title}
      </h3>
      {active && liveIntro ? (
        // Stage intro = static orientation copy (not the coach
        // speaking). Distinct visual treatment so the reader
        // recognizes the block type at a glance:
        //   - Left accent bar in muted grey (coach messages use
        //     primary blue at /70; using text-muted here keeps
        //     the two visually separated)
        //   - Slight surface lift + inner border for a "card"
        //     feel that stands out from the row backgrounds
        //   - "HOW THIS WORKS" label as a small icon-adjacent
        //     header with brand-primary color for contrast
        //   - Body text at white/85 (not italic, not muted grey)
        //     so it's actually readable, not something to scan past
        <div className="mb-4 overflow-hidden rounded-md border border-[color:var(--color-primary)]/20 border-l-[3px] border-l-[color:var(--color-primary)]/60 bg-[color:var(--color-surface)] shadow-sm">
          <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-primary)]/[0.04] px-4 py-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--color-primary)]/90">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a1 1 0 0 0 0 2v3a1 1 0 0 0 1 1h1a1 1 0 1 0 0-2v-3a1 1 0 0 0-1-1H9Z"
                  clipRule="evenodd"
                />
              </svg>
              How this works
            </div>
          </div>
          <div className="px-4 py-3 text-sm leading-relaxed text-white/85 whitespace-pre-wrap">
            {liveIntro}
          </div>
        </div>
      ) : null}
      {beforeNotes ? <div className="mb-4">{beforeNotes}</div> : null}
      {notesToShow.length > 0 ? (
        <div className="mb-4 space-y-2">
          {notesToShow.map((m) => (
            <StageNote key={m.id} content={m.content} chipTarget={chipTarget} />
          ))}
        </div>
      ) : null}
      {children}
      {active && columnReview ? (
        <ColumnReviewNote content={columnReview.content} />
      ) : null}
    </section>
  );
}

/**
 * Distinct visual treatment for the end-of-column coach audit. Sits
 * below the coachee's own inputs (behaviors / worries / commitments /
 * goal). Amber accent so it reads as "the coach checked your set
 * before you move on" rather than another mid-flow reaction. Kept as
 * a plain read: no chip target, no accept-tap, no state change. It's
 * a nudge to reflect, not a state transition.
 */
function ColumnReviewNote({ content }: { content: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-[color:var(--color-warning)]/40 border-l-[3px] border-l-[color:var(--color-warning)] bg-[color:var(--color-surface)] shadow-sm">
      <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-warning)]/[0.05] px-4 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-[color:var(--color-warning)]">
          Coach's take on this set
        </div>
      </div>
      <div className="px-4 py-3 text-sm leading-relaxed text-white/90 whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

function StageNote({
  content,
  chipTarget,
}: {
  content: string;
  chipTarget?: ChipTarget;
}) {
  // Stage notes may carry chips too (suggestions render as stage_note).
  const fence = /\n?```coach-chips\s*\n([\s\S]*?)\n```\s*$/;
  const match = content.match(fence);
  const prose = match ? content.slice(0, match.index).trimEnd() : content;
  let chips: { refinement?: string; suggestions?: string[] } | null = null;
  if (match) {
    try {
      chips = JSON.parse(match[1]);
    } catch {
      chips = null;
    }
  }
  return (
    <div className="rounded-md border border-[color:var(--color-primary)]/25 border-l-[3px] border-l-[color:var(--color-primary)]/70 bg-[color:var(--color-primary)]/[0.10] px-4 py-3 text-base leading-relaxed">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-primary)]/90 mb-1.5">
        Coach
      </div>
      <div className="whitespace-pre-wrap">{prose}</div>
      {chips && (chips.refinement || (chips.suggestions?.length ?? 0) > 0) && chipTarget ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.refinement ? (
            <ChipButton value={chips.refinement} target={chipTarget} />
          ) : null}
          {chips.suggestions?.map((s, i) => (
            <ChipButton key={i} value={s} target={chipTarget} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChipButton({ value, target }: { value: string; target: ChipTarget }) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent("itc-chip-fill", { detail: { value, target } }),
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-full border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/10 px-3 py-1 text-sm text-white hover:bg-[color:var(--color-primary)]/20"
      title="Use this in the input"
    >
      {value}
    </button>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
      {children}
    </p>
  );
}

function ContinueBar({
  mapId,
  gate,
}: {
  mapId: string;
  gate: AdvanceGate;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!gate.to) return null;
  function submit() {
    if (!gate.to) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("to", gate.to);
    startTransition(async () => {
      const res = await advanceToStage(fd);
      if (!res.ok) setError(res.reason ?? "Could not advance.");
    });
  }
  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={submit}
        disabled={pending || !gate.enabled}
        title={gate.enabled ? undefined : gate.reason ?? "Not ready to advance."}
        aria-describedby={!gate.enabled && gate.reason ? "advance-gate-reason" : undefined}
        aria-busy={pending ? "true" : undefined}
        className="w-full rounded-md bg-[color:var(--color-primary)] px-4 py-3 text-base font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {pending ? (
          // Spinner + label instead of a static "…" so the coachee
          // sees the button is actively working. Advance can take
          // 5-10s while the server drafts every worry/commitment.
          <span className="inline-flex items-center gap-2 justify-center">
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="3"
              />
              <path
                d="M12 2a10 10 0 0 1 10 10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span>{gate.label}</span>
          </span>
        ) : (
          gate.label
        )}
      </button>
      {!gate.enabled && gate.reason ? (
        <p
          id="advance-gate-reason"
          role="status"
          aria-live="polite"
          className="mt-2 text-sm text-[color:var(--color-text-muted)]/80 text-center"
        >
          {gate.reason}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-[color:var(--color-danger)] text-center">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TestsPanel({
  tests,
  results,
  assumptions,
  stage,
}: {
  tests: ItcTest[];
  results: ItcTestResult[];
  assumptions: ItcAssumption[];
  stage: ItcStage;
}) {
  const resultsByTest = new Map(results.map((r) => [r.test_id, r]));
  const assumptionById = new Map(assumptions.map((a) => [a.id, a]));
  const active = tests[tests.length - 1];
  const activeResult = active ? resultsByTest.get(active.id) ?? null : null;
  const history = tests.slice(0, -1).reverse();
  const showRunningBanner =
    stage === "test_running" && active && !activeResult;

  return (
    <section className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 space-y-3">
      <h3 className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
        Test on the map
      </h3>
      {showRunningBanner ? (
        <div className="rounded-md border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 px-3 py-2 text-xs">
          <div className="font-semibold text-white">Test in progress</div>
          {active.target_date ? (
            <div className="text-[color:var(--color-text-muted)] mt-0.5">
              Come back after {active.target_date} with observations.
            </div>
          ) : (
            <div className="text-[color:var(--color-text-muted)] mt-0.5">
              Come back with observations whenever you're ready.
            </div>
          )}
        </div>
      ) : null}
      {active ? (
        <TestCard
          test={active}
          result={activeResult}
          assumption={assumptionById.get(active.assumption_id) ?? null}
        />
      ) : null}
      {history.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-[color:var(--color-text-muted)]/80">
            Prior tests ({history.length})
          </summary>
          <div className="mt-2 space-y-2">
            {history.map((t) => (
              <TestCard
                key={t.id}
                test={t}
                result={resultsByTest.get(t.id) ?? null}
                assumption={assumptionById.get(t.assumption_id) ?? null}
                muted
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function TestCard({
  test,
  result,
  assumption,
  muted = false,
}: {
  test: ItcTest;
  result: ItcTestResult | null;
  assumption: ItcAssumption | null;
  muted?: boolean;
}) {
  const renderedAt = Date.now();
  const fresh =
    isFresh(test.created_at, renderedAt) ||
    (result ? isFresh(result.created_at, renderedAt) : false);
  return (
    <div
      className={
        "rounded-md border border-[color:var(--color-border)] px-3 py-2 text-sm " +
        (muted ? "bg-black/10 opacity-80" : "bg-black/20") +
        (fresh ? " itc-fresh-row" : "")
      }
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {TEST_TYPE_LABELS[test.test_type]}
        </div>
        <div className="text-[10px] text-[color:var(--color-text-muted)]/80">
          {test.status}
          {test.target_date ? ` · target ${test.target_date}` : ""}
        </div>
      </div>
      {assumption ? (
        <div className="text-[11px] text-[color:var(--color-text-muted)]/80 mb-2">
          Testing: <span className="text-white/90">{assumption.text}</span>
        </div>
      ) : null}
      <TestField label="My Big Assumption says" value={test.assumption_says} />
      <TestField label="So I will (change my behavior this way)" value={test.behavior_change} />
      <TestField label="And collect the following data" value={test.data_to_collect} />
      <TestField label="In order to find out whether" value={test.in_order_to_find_out} />
      {result ? (
        <div className="mt-2 pt-2 border-t border-[color:var(--color-border)] space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
            Results
            {result.assumption_verdict
              ? ` · ${result.assumption_verdict.replace(/_/g, " ")}`
              : ""}
          </div>
          <TestField label="What I did" value={result.what_i_did} />
          <TestField label="What I observed" value={result.data_collected} />
          <TestField label="What it says about my Big Assumption" value={result.what_it_says_about_assumption} />
          {result.next_step ? (
            <div className="text-[10px] text-[color:var(--color-text-muted)] mt-1">
              Next: {result.next_step.replace(/_/g, " ")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TestField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mb-1">
      <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-muted)]/80">
        {label}:
      </span>{" "}
      <span className="text-sm">{value}</span>
    </div>
  );
}
