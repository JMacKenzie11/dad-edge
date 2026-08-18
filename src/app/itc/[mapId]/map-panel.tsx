"use client";

import { useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
  ItcMap,
  ItcTest,
  ItcTestResult,
  ItcWorry,
} from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { advanceToStage, type AdvanceGate } from "../actions";
import { GoalRow } from "./goal-row";
import { BehaviorsRow } from "./behaviors-row";

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
 * The live map, laid out as horizontal rows. Under Form-First, every
 * add/edit/remove happens through the map panel — the coach never
 * writes state. The row that matches the current stage is "active"
 * and shows its own add/edit affordances. The Continue button at the
 * bottom advances the stage when preconditions are met.
 */
export function MapPanel({
  map,
  behaviors,
  worries,
  commitments = [],
  assumptions = [],
  assumptionLinks = [],
  tests = [],
  testResults = [],
  advanceGate,
}: {
  map: ItcMap;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments?: ItcCommitment[];
  assumptions?: ItcAssumption[];
  assumptionLinks?: ItcAssumptionCommitment[];
  tests?: ItcTest[];
  testResults?: ItcTestResult[];
  advanceGate?: AdvanceGate;
}) {
  const renderedAt = Date.now();
  const pillar = PILLAR_BY_CODE[map.pillar_code];
  const worriesByBehavior = new Map(worries.map((w) => [w.behavior_id, w]));
  const selectedBehaviors = behaviors.filter((b) => b.selected);
  const worryById = new Map(worries.map((w) => [w.id, w]));
  const commitmentIndexById = new Map(
    commitments.map((c, i) => [c.id, i + 1]),
  );
  const linksByAssumption = new Map<string, string[]>();
  for (const l of assumptionLinks) {
    const arr = linksByAssumption.get(l.assumption_id) ?? [];
    arr.push(l.commitment_id);
    linksByAssumption.set(l.assumption_id, arr);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
            Immunity Map
          </div>
          <div className="text-sm">
            Pillar:{" "}
            <span className="font-semibold" style={{ color: pillar.colorVar }}>
              {pillar.label}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Row title="1. Improvement goal" active={map.current_stage === "goal"}>
          <GoalRow
            mapId={map.id}
            goalText={map.improvement_goal}
            isActive={map.current_stage === "goal"}
          />
        </Row>

        <Row title="2. Doing / not-doing" active={map.current_stage === "behaviors"}>
          <BehaviorsRow
            mapId={map.id}
            behaviors={behaviors}
            isActive={map.current_stage === "behaviors"}
            nowMs={renderedAt}
          />
        </Row>

        <Row title="3. Worry box" active={map.current_stage === "worries"}>
          {selectedBehaviors.length === 0 ? (
            <Placeholder>Fills in after behaviors.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {selectedBehaviors.map((b, i) => {
                const worry = worriesByBehavior.get(b.id);
                return (
                  <li
                    key={b.id}
                    className={
                      "rounded-md border border-[color:var(--color-border)] bg-black/20 px-3 py-2 " +
                      (worry && isFresh(worry.created_at, renderedAt)
                        ? "itc-fresh-row"
                        : "")
                    }
                  >
                    <div className="flex flex-wrap gap-2 items-baseline">
                      <span className="text-[11px] text-[color:var(--color-text-muted)] shrink-0">
                        {i + 1}.
                      </span>
                      <span className="text-[color:var(--color-text-muted)]/80 min-w-[10rem]">
                        {b.text}
                      </span>
                      <span className="text-[color:var(--color-text-muted)]/50 shrink-0">
                        →
                      </span>
                      {worry ? (
                        <span className="flex-1 min-w-[10rem]">{worry.text}</span>
                      ) : (
                        <span className="italic text-[color:var(--color-text-muted)]/70">
                          not yet
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Row>

        <Row title="4. Competing commitments" active={map.current_stage === "commitments"}>
          {commitments.length === 0 ? (
            <Placeholder>
              My vows to make sure my worries never come true.
            </Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {commitments.map((c, i) => {
                const w = worryById.get(c.worry_id);
                return (
                  <li
                    key={c.id}
                    className={
                      "rounded-md border border-[color:var(--color-border)] bg-black/20 px-3 py-2 " +
                      (isFresh(c.created_at, renderedAt) ? "itc-fresh-row" : "")
                    }
                  >
                    <div className="flex flex-wrap gap-2 items-baseline">
                      <span className="text-[11px] text-[color:var(--color-text-muted)] shrink-0">
                        {i + 1}.
                      </span>
                      <span className="flex-1 min-w-[12rem]">{c.text}</span>
                    </div>
                    {w ? (
                      <div className="text-[10px] text-[color:var(--color-text-muted)]/70 mt-1 pl-5">
                        ↑ worry: {w.text}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Row>

        <Row title="5. Big Assumptions" active={map.current_stage === "assumptions"}>
          {assumptions.length === 0 ? (
            <Placeholder>Comes together from the commitments.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {assumptions.map((a) => {
                const linkedIndices = (linksByAssumption.get(a.id) ?? [])
                  .map((cid) => commitmentIndexById.get(cid))
                  .filter((n): n is number => typeof n === "number")
                  .sort((x, y) => x - y);
                return (
                  <li
                    key={a.id}
                    className={
                      "rounded-md border px-3 py-2 " +
                      (a.selected_for_testing
                        ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                        : a.coach_recommended
                          ? "border-[color:var(--color-primary)]/40 bg-black/20"
                          : "border-[color:var(--color-border)] bg-black/20") +
                      (isFresh(a.created_at, renderedAt) ? " itc-fresh-row" : "")
                    }
                  >
                    <div className="flex flex-wrap gap-2 items-baseline">
                      <span className="flex-1 min-w-[12rem]">{a.text}</span>
                      {linkedIndices.length > 0 ? (
                        <span className="text-[10px] text-[color:var(--color-text-muted)]/70 shrink-0">
                          underwrites {linkedIndices.join(", ")}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Row>
      </div>

      {tests.length > 0 ? (
        <TestsPanel
          tests={tests}
          results={testResults}
          assumptions={assumptions}
          stage={map.current_stage}
        />
      ) : null}

      {advanceGate ? <ContinueBar mapId={map.id} gate={advanceGate} /> : null}
    </div>
  );
}

function Row({
  title,
  children,
  active = false,
}: {
  title: string;
  children: React.ReactNode;
  active?: boolean;
}) {
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
      {children}
    </section>
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

// ---- Tests panel (unchanged from prior — used at test_design/running/results stages) ----

function TestsPanel({
  tests,
  results,
  assumptions,
  stage,
}: {
  tests: ItcTest[];
  results: ItcTestResult[];
  assumptions: ItcAssumption[];
  stage: ItcMap["current_stage"];
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

// Silence unused type imports (kept for future stage checkpoints)
void (null as unknown as ItcStage);
