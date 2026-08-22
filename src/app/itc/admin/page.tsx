import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import { listAllMaps } from "@/lib/itc/maps";
import { listAllParticipants } from "@/lib/itc/participant";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { STAGE_LABELS } from "@/lib/itc/stage";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import {
  buildMapTriage,
  HEALTH_SORT_ORDER,
  type MapHealth,
  type MapTriage,
} from "@/lib/itc/triage";

export const dynamic = "force-dynamic";

/**
 * ITC admin triage view — every in-progress map, sorted by how much
 * help the coachee looks like he needs. Signals-only for v1 (no
 * messaging affordance yet).
 *
 * Health signals per map computed by src/lib/itc/triage.ts. Sort
 * order: stuck > overdue_test > idle > stalling > ok, so anyone
 * needing a push sits at the top of the page.
 */
export default async function ItcAdminPage() {
  const viewer = await requireItcParticipant();
  if (!isItcAdmin(viewer.email)) notFound();

  const [participants, allMaps] = await Promise.all([
    listAllParticipants(),
    listAllMaps(),
  ]);
  const participantsById = new Map(participants.map((p) => [p.id, p]));

  const inProgressMaps = allMaps.filter((m) => m.status === "in_progress");

  // Build triage for every in-progress map in parallel.
  const triageRows = await Promise.all(
    inProgressMaps.map(async (m) => {
      const triage = await buildMapTriage(m);
      const participant = participantsById.get(m.participant_id);
      const pillar = PILLAR_BY_CODE[m.pillar_code];
      return {
        map: m,
        triage,
        participantEmail: participant?.email ?? "(unknown participant)",
        pillarLabel: pillar.label,
        pillarColorVar: pillar.colorVar,
      };
    }),
  );

  // Sort by health severity (most-in-need first), then by days since
  // update descending inside each bucket so the coldest map in each
  // health tier surfaces first.
  triageRows.sort((a, b) => {
    const healthDelta =
      HEALTH_SORT_ORDER[a.triage.health] - HEALTH_SORT_ORDER[b.triage.health];
    if (healthDelta !== 0) return healthDelta;
    return b.triage.daysSinceUpdate - a.triage.daysSinceUpdate;
  });

  const counts = triageRows.reduce(
    (acc, r) => {
      acc[r.triage.health] += 1;
      return acc;
    },
    { stuck: 0, overdue_test: 0, idle: 0, stalling: 0, ok: 0 } as Record<
      MapHealth,
      number
    >,
  );

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">
              ITC Admin: active-map triage
            </h1>
            <p className="text-xs text-[color:var(--color-muted)]">
              Signed in as {viewer.email}. Every in-progress map with a
              health signal per coachee. Sorted by who needs help most.
            </p>
          </div>
          <Link
            href="/itc"
            className="text-xs text-[color:var(--color-muted)] hover:text-white"
          >
            ← Back to my map
          </Link>
        </header>

        {triageRows.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">
            No in-progress maps.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-[11px] font-heading tracking-widest">
              <HealthCount health="stuck" count={counts.stuck} />
              <HealthCount health="overdue_test" count={counts.overdue_test} />
              <HealthCount health="idle" count={counts.idle} />
              <HealthCount health="stalling" count={counts.stalling} />
              <HealthCount health="ok" count={counts.ok} />
            </div>

            <ul className="space-y-3">
              {triageRows.map((row) => (
                <TriageRow key={row.map.id} row={row} />
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

function TriageRow({
  row,
}: {
  row: {
    map: { id: string; current_stage: string; improvement_goal: string | null };
    triage: MapTriage;
    participantEmail: string;
    pillarLabel: string;
    pillarColorVar: string;
  };
}) {
  const { map, triage, participantEmail, pillarLabel, pillarColorVar } = row;
  const badgeColor = HEALTH_BADGE_COLOR[triage.health];
  return (
    <li className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 inline-block h-6 w-1.5 rounded-full shrink-0"
          style={{ background: pillarColorVar }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{
                background: `${badgeColor}22`,
                color: badgeColor,
                border: `1px solid ${badgeColor}66`,
              }}
            >
              {HEALTH_LABEL[triage.health]}
            </span>
            <span className="text-sm font-semibold">{participantEmail}</span>
            <span className="text-xs text-[color:var(--color-muted)]">
              {pillarLabel} · {STAGE_LABELS[map.current_stage as keyof typeof STAGE_LABELS] ?? map.current_stage}
            </span>
          </div>
          <p className="text-xs mt-1 leading-relaxed">{triage.reason}</p>
          {map.improvement_goal ? (
            <p className="text-xs text-[color:var(--color-muted)] mt-1 italic truncate">
              {map.improvement_goal}
            </p>
          ) : null}
          <p className="text-[10px] text-[color:var(--color-muted)] mt-1">
            Last activity {triage.daysSinceUpdate}d ago · on this stage {triage.daysOnCurrentStage}d
          </p>
          {triage.stuckAtStage ? (
            <ul className="mt-2 space-y-1">
              {triage.stuckAtStage.entries.map((e) => (
                <li
                  key={e.id}
                  className="text-[11px] text-[color:var(--color-muted)] pl-3 border-l-2 border-[color:var(--color-warning)]/50"
                >
                  <span className="text-[color:var(--color-warning)]">
                    depth {e.depthScore}/3, {e.attempts} attempts
                  </span>
                  <span className="italic ml-2">{truncate(e.text, 140)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2">
            <Link
              href={`/itc/admin/${map.id}`}
              className="text-xs text-[color:var(--color-primary)] hover:underline"
            >
              Open transcript →
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}

function HealthCount({
  health,
  count,
}: {
  health: MapHealth;
  count: number;
}) {
  if (count === 0) return null;
  const color = HEALTH_BADGE_COLOR[health];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 border"
      style={{
        background: `${color}22`,
        color,
        borderColor: `${color}66`,
      }}
    >
      {HEALTH_LABEL[health]} · {count}
    </span>
  );
}

const HEALTH_LABEL: Record<MapHealth, string> = {
  stuck: "STUCK",
  overdue_test: "OVERDUE TEST",
  idle: "IDLE",
  stalling: "STALLING",
  ok: "ACTIVE",
};

const HEALTH_BADGE_COLOR: Record<MapHealth, string> = {
  stuck: "var(--color-danger)",
  overdue_test: "var(--color-warning)",
  idle: "var(--color-warning)",
  stalling: "var(--color-text-muted)",
  ok: "var(--color-primary)",
};

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
