import type { ItcBehavior, ItcMap } from "@/lib/itc/maps";
import { PILLAR_BY_CODE } from "@/lib/pillars";

/**
 * The live map. Renders the four columns plus the worry box. Columns 3+
 * are empty at Checkpoint B (worries/commitments/assumptions still ahead)
 * but the frame is here so the coachee always sees the whole picture.
 */
export function MapPanel({
  map,
  behaviors,
}: {
  map: ItcMap;
  behaviors: ItcBehavior[];
}) {
  const pillar = PILLAR_BY_CODE[map.pillar_code];
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
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
          <p className="mt-2 text-[11px] text-[color:var(--color-muted)]">
            Worry box pairs 1:1 with these — coming next.
          </p>
        </Column>

        <Column title="3. Hidden commitments">
          <Placeholder>Reveal in the commitments stage.</Placeholder>
        </Column>

        <Column title="4. Big Assumptions">
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
