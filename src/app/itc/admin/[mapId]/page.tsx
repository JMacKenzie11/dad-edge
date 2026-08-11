import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import {
  getMapById,
  listBehaviors,
  listMessages,
  listWorries,
} from "@/lib/itc/maps";
import { getParticipantById } from "@/lib/itc/participant";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { MapPanel } from "../../[mapId]/map-panel";
import { StageProgress } from "../../[mapId]/stage-progress";

export default async function ItcAdminMapPage({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const viewer = await requireItcParticipant();
  if (!isItcAdmin(viewer.email)) notFound();

  const { mapId } = await params;
  const map = await getMapById(mapId);
  if (!map) notFound();

  const [owner, messages, behaviors, worries] = await Promise.all([
    getParticipantById(map.participant_id),
    listMessages(map.id),
    listBehaviors(map.id),
    listWorries(map.id),
  ]);

  const displayMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-[color:var(--color-border)] px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/itc/admin"
            className="text-xs text-[color:var(--color-muted)] hover:text-white whitespace-nowrap"
          >
            ← All maps
          </Link>
          <div className="text-xs text-[color:var(--color-muted)] truncate">
            Viewing {owner?.email ?? "(unknown)"} · admin read-only
          </div>
        </div>
        <div className="hidden md:block flex-1 max-w-3xl">
          <StageProgress current={map.current_stage} />
        </div>
      </header>

      <div className="md:hidden px-4 py-2 border-b border-[color:var(--color-border)]">
        <StageProgress current={map.current_stage} />
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] min-h-0">
        <section className="border-b md:border-b-0 md:border-r border-[color:var(--color-border)] p-4 min-h-[420px] md:min-h-0 overflow-y-auto">
          <ol className="space-y-3 pr-1">
            {displayMessages.length === 0 ? (
              <li className="text-sm italic text-[color:var(--color-muted)]">
                No conversation yet.
              </li>
            ) : null}
            {displayMessages.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-2 text-sm"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.content}
              </li>
            ))}
          </ol>
        </section>
        <section className="p-4 overflow-y-auto">
          <MapPanel map={map} behaviors={behaviors} worries={worries} />
        </section>
      </div>
    </main>
  );
}
