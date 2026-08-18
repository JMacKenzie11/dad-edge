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
import { BehaviorsColumn } from "./behaviors-column";
import { GoalColumn } from "./goal-column";

const TEST_TYPE_LABELS: Record<ItcTest["test_type"], string> = {
  data_mining: "Data mining",
  observation: "Self-observation",
  thought_experiment: "Thought experiment",
  behavioral: "Behavioral",
};

// Rows created within this many ms of the current render get the
// itc-fresh-row highlight animation. Long enough to cover typical LLM
// turn latency (5-15s) so the just-landed entry is visible after the
// server-action revalidate.
const FRESH_ROW_MS = 15_000;

function isFresh(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return false;
  return nowMs - then < FRESH_ROW_MS;
}

/**
 * The live map. Renders the four numbered columns plus the worry box that
 * sits between behaviors and hidden commitments — the classic ITC bridge:
 * each behavior generates a worry (if I stop doing X, I'm afraid Y), and
 * each worry surfaces a hidden competing commitment.
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
  goalDraftFromChat = null,
}: {
  map: ItcMap;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments?: ItcCommitment[];
  assumptions?: ItcAssumption[];
  assumptionLinks?: ItcAssumptionCommitment[];
  tests?: ItcTest[];
  testResults?: ItcTestResult[];
  goalDraftFromChat?: string | null;
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
          <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
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

      <div
        className="grid gap-2 max-md:!grid-cols-1"
        style={{
          gridTemplateColumns: columnWeightsForStage(map.current_stage)
            .map((w) => `minmax(0, ${w}fr)`)
            .join(" "),
        }}
      >
        <Column
          title="1. Improvement goal"
          active={activeColumnForStage(map.current_stage) === 1}
        >
          <GoalColumn
            mapId={map.id}
            currentStage={map.current_stage}
            goalText={map.improvement_goal}
            draftFromChat={goalDraftFromChat}
          />
        </Column>

        <Column
          title="2. Doing / not-doing"
          active={activeColumnForStage(map.current_stage) === 2}
        >
          <BehaviorsColumn
            mapId={map.id}
            currentStage={map.current_stage}
            behaviors={behaviors}
          />
        </Column>

        <Column
          title="3. Worry box"
          active={activeColumnForStage(map.current_stage) === 3}
        >
          {selectedBehaviors.length === 0 ? (
            <Placeholder>Fills in after behaviors.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {selectedBehaviors.map((b) => {
                const worry = worriesByBehavior.get(b.id);
                return (
                  <li
                    key={b.id}
                    className={
                      "rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1.5" +
                      (worry && isFresh(worry.created_at, renderedAt)
                        ? " itc-fresh-row"
                        : "")
                    }
                  >
                    {worry ? (
                      worry.text
                    ) : (
                      <span className="italic text-[color:var(--color-muted)]/70">
                        Paired to: {b.text}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Column>

        <Column
          title="4. Competing commitments"
          active={activeColumnForStage(map.current_stage) === 4}
        >
          {commitments.length === 0 ? (
            <Placeholder>My vows to make sure my worries never come true.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {commitments.map((c, i) => {
                const w = worryById.get(c.worry_id);
                return (
                  <li
                    key={c.id}
                    className={
                      "rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1.5" +
                      (isFresh(c.created_at, renderedAt) ? " itc-fresh-row" : "")
                    }
                  >
                    <span className="text-[color:var(--color-muted)] text-[11px]">
                      {i + 1}.
                    </span>{" "}
                    {c.text}
                    {w ? (
                      <div className="text-[10px] text-[color:var(--color-muted)]/70 mt-1">
                        ↑ worry: {w.text}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Column>

        <Column
          title="5. Big Assumptions"
          active={activeColumnForStage(map.current_stage) === 5}
        >
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
                      "rounded-md border px-2 py-1.5 " +
                      (a.selected_for_testing
                        ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                        : a.coach_recommended
                          ? "border-[color:var(--color-primary)]/40 bg-black/20"
                          : "border-[color:var(--color-border)] bg-black/20") +
                      (isFresh(a.created_at, renderedAt) ? " itc-fresh-row" : "")
                    }
                  >
                    {a.text}
                    {linkedIndices.length > 0 ? (
                      <div className="text-[10px] text-[color:var(--color-muted)]/70 mt-1">
                        underwrites commitments {linkedIndices.join(", ")}
                      </div>
                    ) : null}
                    {a.selected_for_testing ? (
                      <div className="text-[10px] text-[color:var(--color-primary)] mt-1">
                        Selected for testing
                      </div>
                    ) : a.coach_recommended ? (
                      <div className="text-[10px] text-[color:var(--color-muted)] mt-1">
                        Coach recommends
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Column>
      </div>

      {tests.length > 0 ? (
        <TestsPanel
          tests={tests}
          results={testResults}
          assumptions={assumptions}
          stage={map.current_stage}
        />
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
      <h3 className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
        Test on the map
      </h3>

      {showRunningBanner ? (
        <div className="rounded-md border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 px-3 py-2 text-xs">
          <div className="font-semibold text-white">
            Test in progress
          </div>
          {active.target_date ? (
            <div className="text-[color:var(--color-muted)] mt-0.5">
              Come back after {active.target_date} with observations.
            </div>
          ) : (
            <div className="text-[color:var(--color-muted)] mt-0.5">
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
          <summary className="cursor-pointer text-[color:var(--color-muted)]/80">
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
        <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
          {TEST_TYPE_LABELS[test.test_type]}
        </div>
        <div className="text-[10px] text-[color:var(--color-muted)]/80">
          {test.status}
          {test.target_date ? ` · target ${test.target_date}` : ""}
        </div>
      </div>

      {assumption ? (
        <div className="text-[11px] text-[color:var(--color-muted)]/80 mb-2">
          Testing: <span className="text-white/90">{assumption.text}</span>
        </div>
      ) : null}

      <TestField label="My Big Assumption says" value={test.assumption_says} />
      <TestField
        label="So I will (change my behavior this way)"
        value={test.behavior_change}
      />
      <TestField
        label="And collect the following data"
        value={test.data_to_collect}
      />
      <TestField
        label="In order to find out whether"
        value={test.in_order_to_find_out}
      />

      {result ? (
        <div className="mt-2 pt-2 border-t border-[color:var(--color-border)] space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
            Results
            {result.assumption_verdict
              ? ` · ${result.assumption_verdict.replace(/_/g, " ")}`
              : ""}
          </div>
          <TestField
            label="So in order to test it I changed my behavior this way"
            value={result.what_i_did}
          />
          <TestField
            label="This is what I observed happening"
            value={result.data_collected}
          />
          <TestField
            label="And this is what it tells me about my Big Assumption"
            value={result.what_it_says_about_assumption}
          />
          {result.next_step ? (
            <div className="text-[10px] text-[color:var(--color-muted)] mt-1">
              Next: {result.next_step.replace(/_/g, " ")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TestField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="mb-1">
      <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]/80">
        {label}:
      </span>{" "}
      <span className="text-sm">{value}</span>
    </div>
  );
}

function Column({
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
        "rounded-[var(--radius-card)] border bg-[color:var(--color-surface)] p-3 min-h-[160px] transition-colors " +
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
            : "text-[color:var(--color-muted)]")
        }
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Which physical column (1-5) is the "active" one for a given stage.
 * The active column expands via columnWeightsForStage; the others
 * compress to summary width. Stages that don't map to a single
 * column (review, walkthrough, test_*, done) return null so all
 * columns render at equal weight.
 */
function activeColumnForStage(stage: ItcStage): number | null {
  switch (stage) {
    case "goal":
      return 1;
    case "behaviors":
      return 2;
    case "worries":
      return 3;
    case "commitments":
      return 4;
    case "assumptions":
    case "prioritize":
      return 5;
    default:
      return null;
  }
}

/**
 * fr weights for the 5-column grid. Active column gets a wide slot;
 * the other columns collapse to narrow summary strips. When no active
 * column (review / walkthrough / test / done), all get equal weight.
 */
function columnWeightsForStage(stage: ItcStage): number[] {
  const active = activeColumnForStage(stage);
  if (active === null) return [1, 1, 1, 1, 1];
  return [1, 2, 3, 4, 5].map((n) => (n === active ? 4 : 1));
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs italic text-[color:var(--color-muted)]/70">{children}</p>
  );
}
