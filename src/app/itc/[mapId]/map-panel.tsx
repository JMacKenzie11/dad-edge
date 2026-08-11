import type { ItcBehavior, ItcMap, ItcWorry } from "@/lib/itc/maps";
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
}: {
  map: ItcMap;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
}) {
  const pillar = PILLAR_BY_CODE[map.pillar_code];
  const worriesByBehavior = new Map(worries.map((w) => [w.behavior_id, w]));

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
          {behaviors.length === 0 ? (
            <Placeholder>None yet.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {behaviors.map((b) => (
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
          {behaviors.length === 0 ? (
            <Placeholder>Fills in after behaviors.</Placeholder>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {behaviors.map((b) => {
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
          <p className="mt-2 text-[11px] text-[color:var(--color-muted)]">
            If I stopped doing that, I'm afraid…
          </p>
        </Column>

        <Column title="4. Hidden commitments">
          <Placeholder>Follows from each worry.</Placeholder>
        </Column>

        <Column title="5. Big Assumptions">
          <Placeholder>If-then form. Reveal at the end.</Placeholder>
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
