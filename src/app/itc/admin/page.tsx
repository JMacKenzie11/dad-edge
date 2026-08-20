import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import { listAllMaps } from "@/lib/itc/maps";
import { listAllParticipants } from "@/lib/itc/participant";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { STAGE_LABELS } from "@/lib/itc/stage";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { AdminMapsList, type AdminMapListRow } from "./admin-maps-list";

export default async function ItcAdminPage() {
  const viewer = await requireItcParticipant();
  if (!isItcAdmin(viewer.email)) notFound();

  const [participants, allMaps] = await Promise.all([
    listAllParticipants(),
    listAllMaps(),
  ]);

  // Hide completed maps from the default admin view — they're not what
  // the facilitator is watching. Add a query-string toggle later if
  // reviewing historical maps becomes a real need.
  const maps = allMaps.filter((m) => m.status === "in_progress");

  const participantsById = new Map(participants.map((p) => [p.id, p]));

  const rows: AdminMapListRow[] = maps.map((m) => {
    const participant = participantsById.get(m.participant_id);
    const pillar = PILLAR_BY_CODE[m.pillar_code];
    return {
      mapId: m.id,
      email: participant?.email ?? "(unknown participant)",
      goal: m.improvement_goal,
      stageLabel: STAGE_LABELS[m.current_stage] ?? m.current_stage,
      currentStage: m.current_stage,
      pillarLabel: pillar.label,
      pillarColorVar: pillar.colorVar,
      status: m.status,
      updatedAtIso: m.updated_at,
    };
  });

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">
              ITC Admin: active maps
            </h1>
            <p className="text-xs text-[color:var(--color-muted)]">
              Signed in as {viewer.email}. Read-only view of every in-progress map.
            </p>
          </div>
          <Link
            href="/itc"
            className="text-xs text-[color:var(--color-muted)] hover:text-white"
          >
            ← Back to my map
          </Link>
        </header>

        {rows.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">
            No maps yet.
          </p>
        ) : (
          <AdminMapsList rows={rows} />
        )}
      </div>
    </main>
  );
}
