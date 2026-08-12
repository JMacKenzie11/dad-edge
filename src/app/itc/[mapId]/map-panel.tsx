import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
  ItcMap,
  ItcWorry,
} from "@/lib/itc/maps";
import { PILLAR_BY_CODE } from "@/lib/pillars";

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
}: {
  map: ItcMap;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments?: ItcCommitment[];
  assumptions?: ItcAssumption[];
  assumptionLinks?: ItcAssumptionCommitment[];
}) {
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

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <Column title="1. Improvement goal">
          {map.improvement_goal ? (
            <p className="text-sm leading-relaxed">{map.improvement_goal}</p>
          ) : (
            <Placeholder>Not yet set.</Placeholder>
          )}
        </Column>

        <Column title="2. Doing / not-doing">
          {selectedBehaviors.length === 0 ? (
            <Placeholder>None yet.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {selectedBehaviors.map((b) => (
                <li
                  key={b.id}
                  className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1.5"
                >
                  {b.text}
                </li>
              ))}
            </ul>
          )}
        </Column>

        <Column title="3. Worry box">
          {selectedBehaviors.length === 0 ? (
            <Placeholder>Fills in after behaviors.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {selectedBehaviors.map((b) => {
                const worry = worriesByBehavior.get(b.id);
                return (
                  <li
                    key={b.id}
                    className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1.5"
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

        <Column title="4. Competing commitments">
          {commitments.length === 0 ? (
            <Placeholder>Follows from each worry.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {commitments.map((c, i) => {
                const w = worryById.get(c.worry_id);
                return (
                  <li
                    key={c.id}
                    className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1.5"
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

        <Column title="5. Big Assumptions">
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
                          : "border-[color:var(--color-border)] bg-black/20")
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
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 min-h-[160px]">
      <h3 className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)] mb-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs italic text-[color:var(--color-muted)]/70">{children}</p>
  );
}
