import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import {
  getMapForParticipant,
  listActionProposalsForMap,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMessagesForStage,
  listTestResults,
  listTests,
  listWorries,
} from "@/lib/itc/maps";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { getAdvanceGate } from "../actions";
import { Conversation } from "./conversation";
import { MapPanel } from "./map-panel";
import { ResetMapButton } from "./reset-map-button";
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

  const [
    messages,
    proposals,
    behaviors,
    worries,
    commitments,
    assumptions,
    assumptionLinks,
    tests,
    testResults,
    advanceGate,
  ] = await Promise.all([
    listMessagesForStage(map.id, map.current_stage),
    listActionProposalsForMap(map.id),
    listBehaviors(map.id),
    listWorries(map.id),
    listCommitments(map.id),
    listAssumptions(map.id),
    listAssumptionLinks(map.id),
    listTests(map.id),
    listTestResults(map.id),
    getAdvanceGate(map.id),
  ]);

  return (
    <main className="min-h-screen md:h-screen flex flex-col md:overflow-hidden">
      <header className="border-b border-[color:var(--color-border)] px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/itc"
            className="text-xs text-[color:var(--color-muted)] hover:text-white"
          >
            ← Maps
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {isItcAdmin(participant.email) ? (
            <Link
              href="/itc/admin"
              className="text-xs text-[color:var(--color-muted)] hover:text-white"
            >
              Admin
            </Link>
          ) : null}
          <ResetMapButton mapId={map.id} />
          <form action="/itc/logout" method="POST">
            <button
              type="submit"
              className="text-xs text-[color:var(--color-muted)] hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="px-4 py-3 border-b border-[color:var(--color-border)]">
        <StageProgress current={map.current_stage} />
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:min-h-0">
        <section className="border-b md:border-b-0 md:border-r border-[color:var(--color-border)] p-4 min-h-[420px] md:min-h-0 md:overflow-hidden flex flex-col">
          <Conversation
            mapId={map.id}
            messages={messages}
            proposals={proposals}
            advanceGate={advanceGate}
          />
        </section>
        <section className="p-4 md:min-h-0 md:overflow-y-auto">
          <MapPanel
            map={map}
            behaviors={behaviors}
            worries={worries}
            commitments={commitments}
            assumptions={assumptions}
            assumptionLinks={assumptionLinks}
            tests={tests}
            testResults={testResults}
          />
        </section>
      </div>
    </main>
  );
}
