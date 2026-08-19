"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
  ItcMap,
  ItcMessage,
  ItcTest,
  ItcTestResult,
  ItcWorry,
} from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";
import { isLegacyCannedIntro, STAGE_INTROS } from "@/lib/itc/stage-intros";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { advanceToStage, type AdvanceGate } from "../actions";
import { AssumptionsRow } from "./assumptions-row";
import { BehaviorsRow } from "./behaviors-row";
import { CoachDock } from "./coach-dock";
import { CommitmentsRow } from "./commitments-row";
import { EntryThread } from "./entry-thread";
import { GoalRow } from "./goal-row";
import { WorriesRow } from "./worries-row";

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
  tests: ItcTest[];
  testResults: ItcTestResult[];
  messages: ItcMessage[];
  advanceGate: AdvanceGate;
}) {
  const renderedAt = Date.now();
  const pillar = PILLAR_BY_CODE[map.pillar_code];

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
  const dockMessages = useMemo(
    () => messages.filter((m) => m.surface === "dock"),
    [messages],
  );
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
    return STAGE_INTROS[stage]?.({ goal: map.improvement_goal });
  };

  const worriesByBehavior = new Map(worries.map((w) => [w.behavior_id, w]));
  const selectedBehaviors = behaviors.filter((b) => b.selected);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
            Immunity Map
          </div>
          <div className="text-sm">
            Pillar:{" "}
            <span
              className="font-semibold"
              style={{ color: pillar.colorVar }}
            >
              {pillar.label}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Section
          title="1. Improvement goal"
          active={map.current_stage === "goal"}
          stageNotes={map.current_stage === "goal" ? stageNotes : []}
          unattachedCoachNotes={
            map.current_stage === "goal" ? unattachedForCurrentStage : []
          }
        >
          <GoalRow
            mapId={map.id}
            goalText={map.improvement_goal}
          />
          {map.improvement_goal ? (
            <EntryThread
              messages={threadFor("itc_maps", map.id).filter(
                (m) => m.stage_at_creation === "goal",
              )}
            />
          ) : null}
        </Section>

        {advanceGate && map.current_stage === "goal" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="2. Doing / not-doing"
          active={map.current_stage === "behaviors"}
          liveIntro={liveIntroFor("behaviors")}
          stageNotes={map.current_stage === "behaviors" ? stageNotes : []}
          unattachedCoachNotes={
            map.current_stage === "behaviors" ? unattachedForCurrentStage : []
          }
        >
          <BehaviorsRow
            mapId={map.id}
            behaviors={behaviors}
            nowMs={renderedAt}
          />
          {/* Behavior-level threads render inside BehaviorsRow via
              per-item props. To keep the row component focused, we
              render them here as a follow-up list keyed by behavior
              id. */}
          {selectedBehaviors.length > 0 ? (
            <div className="pl-3 mt-1 space-y-2">
              {selectedBehaviors.map((b, i) => {
                const thread = threadFor("itc_behaviors", b.id);
                if (thread.length === 0) return null;
                return (
                  <div key={b.id}>
                    <div className="text-[10px] text-[color:var(--color-text-muted)]/70 pl-2 mb-1">
                      Coach on #{i + 1}
                    </div>
                    <EntryThread messages={thread} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </Section>

        {advanceGate && map.current_stage === "behaviors" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="3. Worry box"
          active={map.current_stage === "worries"}
          liveIntro={liveIntroFor("worries")}
          stageNotes={map.current_stage === "worries" ? stageNotes : []}
          unattachedCoachNotes={
            map.current_stage === "worries" ? unattachedForCurrentStage : []
          }
        >
          <WorriesRow
            mapId={map.id}
            behaviors={behaviors}
            worries={worries}
            nowMs={renderedAt}
          />
          {selectedBehaviors.length > 0 ? (
            <div className="pl-3 mt-1 space-y-2">
              {selectedBehaviors.map((b, i) => {
                const worry = worriesByBehavior.get(b.id);
                if (!worry) return null;
                const thread = threadFor("itc_worries", worry.id);
                if (thread.length === 0) return null;
                return (
                  <div key={worry.id}>
                    <div className="text-[10px] text-[color:var(--color-text-muted)]/70 pl-2 mb-1">
                      Coach on #{i + 1}
                    </div>
                    <EntryThread messages={thread} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </Section>

        {advanceGate && map.current_stage === "worries" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="4. Competing commitments"
          active={map.current_stage === "commitments"}
          liveIntro={liveIntroFor("commitments")}
          stageNotes={map.current_stage === "commitments" ? stageNotes : []}
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
          />
          {commitments.length > 0 ? (
            <div className="pl-3 mt-1 space-y-2">
              {commitments.map((c, i) => {
                const thread = threadFor("itc_commitments", c.id);
                if (thread.length === 0) return null;
                return (
                  <div key={c.id}>
                    <div className="text-[10px] text-[color:var(--color-text-muted)]/70 pl-2 mb-1">
                      Coach on #{i + 1}
                    </div>
                    <EntryThread messages={thread} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </Section>

        {advanceGate && map.current_stage === "commitments" ? (
          <ContinueBar mapId={map.id} gate={advanceGate} />
        ) : null}

        <Section
          title="5. Big Assumptions"
          active={map.current_stage === "assumptions"}
          liveIntro={liveIntroFor("assumptions")}
          stageNotes={map.current_stage === "assumptions" ? stageNotes : []}
          unattachedCoachNotes={
            map.current_stage === "assumptions" ? unattachedForCurrentStage : []
          }
        >
          <AssumptionsRow
            mapId={map.id}
            assumptions={assumptions}
            commitments={commitments}
            links={assumptionLinks}
            nowMs={renderedAt}
          />
          {assumptions.length > 0 ? (
            <div className="pl-3 mt-1 space-y-2">
              {assumptions.map((a, i) => {
                const thread = threadFor("itc_assumptions", a.id);
                if (thread.length === 0) return null;
                return (
                  <div key={a.id}>
                    <div className="text-[10px] text-[color:var(--color-text-muted)]/70 pl-2 mb-1">
                      Coach on #{i + 1}
                    </div>
                    <EntryThread messages={thread} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </Section>
      </div>

      {advanceGate &&
      (map.current_stage === "assumptions" ||
        map.current_stage === "review" ||
        map.current_stage === "immune_system" ||
        map.current_stage === "prioritize" ||
        map.current_stage === "test_design" ||
        map.current_stage === "test_running" ||
        map.current_stage === "results") ? (
        <ContinueBar mapId={map.id} gate={advanceGate} />
      ) : null}

      {tests.length > 0 ? (
        <TestsPanel
          tests={tests}
          results={testResults}
          assumptions={assumptions}
          stage={map.current_stage}
        />
      ) : null}

      <CoachDock mapId={map.id} messages={dockMessages} />
    </div>
  );
}

function Section({
  title,
  children,
  active = false,
  liveIntro,
  stageNotes,
  unattachedCoachNotes = [],
}: {
  title: string;
  children: React.ReactNode;
  active?: boolean;
  /** Live-interpolated stage intro rendered above stored stage notes.
   *  Comes from STAGE_INTROS with the current map state so quotes of
   *  the goal etc. always reflect present values, not a stale snapshot. */
  liveIntro?: string;
  stageNotes: ItcMessage[];
  /** Fallback: assistant messages on this stage with no surface set.
   *  Rendered as stage-note-styled coach notes so the coach's reply
   *  is visible even when the migration adding surface/entry_ref
   *  hasn't been applied yet. Only shown on the active section. */
  unattachedCoachNotes?: ItcMessage[];
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
      className={
        "rounded-[var(--radius-card)] border bg-[color:var(--color-surface)] p-3 " +
        (active
          ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/[0.04]"
          : "border-[color:var(--color-border)]")
      }
    >
      <h3
        className={
          "text-[11px] uppercase tracking-wide mb-2 " +
          (active
            ? "text-[color:var(--color-primary)] font-semibold"
            : "text-[color:var(--color-text-muted)]")
        }
      >
        {title}
      </h3>
      {active && liveIntro ? (
        <div className="mb-3 rounded-md border-l-2 border-[color:var(--color-primary)]/70 bg-[color:var(--color-surface-2)]/70 px-3 py-2 text-sm whitespace-pre-wrap">
          {liveIntro}
        </div>
      ) : null}
      {active && notesToShow.length > 0 ? (
        <div className="mb-3 space-y-1.5">
          {notesToShow.map((m) => (
            <StageNote key={m.id} content={m.content} />
          ))}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function StageNote({ content }: { content: string }) {
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
    <div className="rounded-md border-l-2 border-[color:var(--color-primary)]/70 bg-[color:var(--color-surface-2)]/70 px-3 py-2 text-sm whitespace-pre-wrap">
      {prose}
      {chips && (chips.refinement || (chips.suggestions?.length ?? 0) > 0) ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.refinement ? <ChipButton value={chips.refinement} /> : null}
          {chips.suggestions?.map((s, i) => (
            <ChipButton key={i} value={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChipButton({ value }: { value: string }) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent("itc-chip-fill", { detail: { value } }),
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-full border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/10 px-2.5 py-0.5 text-[11px] text-white hover:bg-[color:var(--color-primary)]/20"
      title="Use this in the input"
    >
      {value}
    </button>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs italic text-[color:var(--color-text-muted)]/70">
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
    <div className="pt-1">
      {gate.enabled ? (
        <p className="mb-1 text-[11px] text-[color:var(--color-text-muted)] text-center">
          Ready when you are. Hit {gate.label} to lock this in and move on.
        </p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !gate.enabled}
        title={gate.enabled ? undefined : gate.reason ?? "Not ready to advance."}
        className="w-full rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {pending ? "…" : gate.label}
      </button>
      {!gate.enabled && gate.reason ? (
        <p className="mt-1 text-[11px] text-[color:var(--color-text-muted)]/80 text-center">
          {gate.reason}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1 text-[11px] text-[color:var(--color-danger)] text-center">
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
