import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMapForParticipant,
  listBehaviors,
  listMessages,
} from "@/lib/itc/maps";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { Conversation } from "./conversation";
import { MapPanel } from "./map-panel";
import { StageProgress } from "./stage-progress";

export default async function ItcMapPage({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  const participant = await requireItcParticipant();
  const map = await getMapForParticipant(mapId, participant.id);
  if (!map) notFound();

  const [messages, behaviors] = await Promise.all([
    listMessages(map.id),
    listBehaviors(map.id),
  ]);

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-[color:var(--color-border)] px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/itc"
            className="text-xs text-[color:var(--color-muted)] hover:text-white"
          >
            ← Maps
          </Link>
          <div className="text-xs text-[color:var(--color-muted)]">
            Signed in as {participant.email}
          </div>
        </div>
        <div className="hidden md:block flex-1 max-w-3xl">
          <StageProgress current={map.current_stage} />
        </div>
        <Link
          href="/itc/logout"
          className="text-xs text-[color:var(--color-muted)] hover:text-white"
        >
          Sign out
        </Link>
      </header>

      <div className="md:hidden px-4 py-2 border-b border-[color:var(--color-border)]">
        <StageProgress current={map.current_stage} />
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] min-h-0">
        <section className="border-b md:border-b-0 md:border-r border-[color:var(--color-border)] p-4 min-h-[420px] md:min-h-0">
          <Conversation
            mapId={map.id}
            stage={map.current_stage}
            messages={messages}
            behaviors={behaviors.map((b) => ({
              id: b.id,
              text: b.text,
              source: b.source,
            }))}
            hasGoal={Boolean(map.improvement_goal)}
          />
        </section>
        <section className="p-4 overflow-y-auto">
          <MapPanel map={map} behaviors={behaviors} />
        </section>
      </div>
    </main>
  );
}
