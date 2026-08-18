import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import {
  getMapForParticipant,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMessages,
  listTestResults,
  listTests,
  listWorries,
} from "@/lib/itc/maps";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { getAdvanceGate } from "../actions";
import { MapCanvas } from "./map-canvas";
import { ResetMapButton } from "./reset-map-button";
import { StageProgress } from "./stage-progress";

/**
 * Full-width single-column ITC canvas. Layout Amendment: the two-
 * pane chat + map layout is gone. Coach output renders inline in
 * four surfaces per §1: stage note (pinned at top of active
 * section), entry threads (beneath each entry row), focus mode
 * (set pieces, future checkpoint), and the coach dock (bottom-
 * right floating drawer).
 */
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
    behaviors,
    worries,
    commitments,
    assumptions,
    assumptionLinks,
    tests,
    testResults,
    advanceGate,
  ] = await Promise.all([
    listMessages(map.id),
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
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-[color:var(--color-border)] px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/itc"
            className="text-xs text-[color:var(--color-text-muted)] hover:text-white"
          >
            ← Maps
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {isItcAdmin(participant.email) ? (
            <Link
              href="/itc/admin"
              className="text-xs text-[color:var(--color-text-muted)] hover:text-white"
            >
              Admin
            </Link>
          ) : null}
          <ResetMapButton mapId={map.id} />
          <form action="/itc/logout" method="POST">
            <button
              type="submit"
              className="text-xs text-[color:var(--color-text-muted)] hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="px-4 py-3 border-b border-[color:var(--color-border)]">
        <StageProgress current={map.current_stage} />
      </div>

      <div className="flex-1 mx-auto w-full max-w-4xl px-4 py-6">
        <MapCanvas
          map={map}
          behaviors={behaviors}
          worries={worries}
          commitments={commitments}
          assumptions={assumptions}
          assumptionLinks={assumptionLinks}
          tests={tests}
          testResults={testResults}
          messages={messages}
          advanceGate={advanceGate}
        />
      </div>
    </main>
  );
}
