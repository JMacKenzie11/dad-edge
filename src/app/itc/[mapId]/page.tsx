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
import { GOAL_STEM } from "@/lib/itc/stage";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { Conversation } from "./conversation";
import { MapPanel } from "./map-panel";
import { ResetMapButton } from "./reset-map-button";
import { StageProgress } from "./stage-progress";

/**
 * Return the most recent line in the transcript that starts with the
 * exact goal stem (case-insensitive). Trims trailing punctuation and
 * whitespace. Returns null if none found. Used to prefill the goal
 * input on Column 1 with something the coachee can accept-as-is or
 * tweak, instead of copy/pasting from chat.
 */
function extractLatestGoalLine(contents: string[]): string | null {
  const stem = GOAL_STEM.toLowerCase();
  for (let i = contents.length - 1; i >= 0; i--) {
    const lines = contents[i].split(/\n+/);
    for (let j = lines.length - 1; j >= 0; j--) {
      const trimmed = lines[j].trim();
      if (trimmed.toLowerCase().startsWith(stem)) {
        return trimmed.replace(/\s+/g, " ");
      }
    }
  }
  return null;
}

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
  ]);

  // Auto-suggested goal input: on the goal stage before a goal is saved,
  // scan the transcript for the most recent line that starts with the
  // goal stem (from either the coach or the coachee). Pass that as a
  // draft the GoalColumn input can prefill with, so the coachee doesn't
  // have to copy/paste his own words (or the coach's echo of them) out
  // of chat into the map. Deterministic string extract, not inference —
  // the stem is exact.
  const goalDraftFromChat =
    map.current_stage === "goal" && !map.improvement_goal
      ? extractLatestGoalLine(messages.map((m) => m.content))
      : null;

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
            goalDraftFromChat={goalDraftFromChat}
          />
        </section>
      </div>
    </main>
  );
}
