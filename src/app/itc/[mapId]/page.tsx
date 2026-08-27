import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import {
  getMapForParticipant,
  listAssumptionDrafts,
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
import {
  ensureMapCloseSummaryDelivered,
  ensurePrioritizeRecommendationDelivered,
  ensureTestDraftDelivered,
  ensureWalkthroughDelivered,
  getAdvanceGate,
} from "../actions";
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

  // Stuck-user recovery: anyone whose map is at the immune_system
  // stage without a delivered walkthrough (because they advanced
  // before this pipeline existed, or an earlier LLM call failed)
  // gets the walkthrough delivered synchronously here before render.
  // Adds one-time 5-15s latency for the recovery case; zero latency
  // for everyone else because ensureWalkthroughDelivered short-
  // circuits when the flag is already set.
  if (map.current_stage === "immune_system" && !map.walkthrough_delivered) {
    await ensureWalkthroughDelivered(map.id);
  }
  // Same recovery pattern for the prioritize stage — anyone stuck on
  // prioritize without a coach-recommended assumption gets the
  // recommendation delivered here before render. Adds one-time
  // 5-10s latency for the recovery case; zero for anyone else
  // because ensurePrioritizeRecommendationDelivered short-circuits
  // when a selection already exists.
  if (map.current_stage === "prioritize") {
    await ensurePrioritizeRecommendationDelivered(map.id);
  }
  // Same recovery pattern for test_design — if coachee lands there
  // with a selected assumption but no test draft, deliver the coach's
  // pre-drafted test before render.
  if (map.current_stage === "test_design") {
    await ensureTestDraftDelivered(map.id);
  }
  // Same recovery pattern for done — if coachee lands there without
  // a closing summary, deliver it before render.
  if (map.current_stage === "done") {
    await ensureMapCloseSummaryDelivered(map.id);
  }

  const [
    messages,
    behaviors,
    worries,
    commitments,
    assumptions,
    assumptionLinks,
    assumptionDrafts,
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
    listAssumptionDrafts(map.id),
    listTests(map.id),
    listTestResults(map.id),
    getAdvanceGate(map.id),
  ]);

  return (
    <main className="flex flex-col">
      {/* In-page utility strip. Stage progress lives in the left
          rail on desktop (ItcStageNav) so it isn't repeated here;
          on mobile the rail is hidden, so we surface a horizontal
          stage strip just below this row. */}
      <div className="flex items-center justify-between gap-4 mb-2">
        <Link
          href="/itc"
          className="text-xs text-[color:var(--color-text-muted)] hover:text-white"
        >
          ← Maps
        </Link>
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
          {/* Sign out kept here for the legacy-cookie fallback path
              (users on /itc/[mapId] without a main-app session — layout
              renders bare children, no header avatar with a sign-out).
              Main-app coachees can also use /me → SIGN OUT. */}
          <form action="/itc/logout" method="POST">
            <button
              type="submit"
              className="text-xs text-[color:var(--color-text-muted)] hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      {/* Mobile-only stage progress strip. Desktop uses ItcStageNav
          in the left rail — where the coachee looks for orientation
          anyway. */}
      <div className="md:hidden border-y border-[color:var(--color-border)]/50 -mx-4 px-4 py-2 mb-4">
        <StageProgress current={map.current_stage} />
      </div>

      <div className="flex-1 mx-auto w-full max-w-4xl">
        <MapCanvas
          map={map}
          behaviors={behaviors}
          worries={worries}
          commitments={commitments}
          assumptions={assumptions}
          assumptionLinks={assumptionLinks}
          assumptionDrafts={assumptionDrafts}
          tests={tests}
          testResults={testResults}
          messages={messages}
          advanceGate={advanceGate}
        />
      </div>
    </main>
  );
}
