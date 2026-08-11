import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import { listAllMaps } from "@/lib/itc/maps";
import { listAllParticipants } from "@/lib/itc/participant";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { PILLAR_BY_CODE } from "@/lib/pillars";

export default async function ItcAdminPage() {
  const viewer = await requireItcParticipant();
  if (!isItcAdmin(viewer.email)) notFound();

  const [participants, maps] = await Promise.all([
    listAllParticipants(),
    listAllMaps(),
  ]);

  const participantsById = new Map(participants.map((p) => [p.id, p]));

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">
              ITC Admin — all maps
            </h1>
            <p className="text-xs text-[color:var(--color-muted)]">
              Signed in as {viewer.email}. Read-only view of every participant's map.
            </p>
          </div>
          <Link
            href="/itc"
            className="text-xs text-[color:var(--color-muted)] hover:text-white"
          >
            ← Back to my map
          </Link>
        </header>

        {maps.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">
            No maps yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {maps.map((m) => {
              const participant = participantsById.get(m.participant_id);
              const pillar = PILLAR_BY_CODE[m.pillar_code];
              return (
                <li key={m.id}>
                  <Link
                    href={`/itc/admin/${m.id}`}
                    className="block rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 hover:border-[color:var(--color-primary)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-sm truncate">
                          {participant?.email ?? "(unknown participant)"}
                        </div>
                        <div className="text-xs text-[color:var(--color-muted)]">
                          <span style={{ color: pillar.colorVar }}>
                            {pillar.label}
                          </span>{" "}
                          · stage: {m.current_stage} · {m.status}
                        </div>
                      </div>
                      <div className="text-[11px] text-[color:var(--color-muted)] whitespace-nowrap">
                        {new Date(m.updated_at).toLocaleString()}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
