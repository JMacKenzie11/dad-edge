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
  ensureAssumptionDraftsDelivered,
  ensureCommitmentDraftsDelivered,
  ensureMapCloseSummaryDelivered,
  ensurePrioritizeRecommendationDelivered,
  ensureTestDraftDelivered,
  ensureWalkthroughDelivered,
  ensureWorryDraftsDelivered,
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

  // Post-advance delivery recovery. advanceToStage moves every stage's
  // delivery (drafters + set-piece prose) behind Next.js after() so
  // the Continue click returns in ~200ms instead of blocking on 5-15s
  // of LLM work. The ensure*Delivered calls below fill in
  // synchronously if the after() work hasn't landed yet by render
  // time. All are idempotent — zero latency once delivery has already
  // happened (short-circuit on existence check).
  //
  // In the common case: after() completes during the roundtrip +
  // browser navigation, and every ensure below returns instantly.
  // In the slow-network / cold-cache case: ensure blocks until the
  // delivery lands. Either way the coachee never sees an empty stage.
  //
  // Draft stages (worries, commitments, assumptions):
  if (map.current_stage === "worries") {
    await ensureWorryDraftsDelivered(map.id);
  }
  if (map.current_stage === "commitments") {
    await ensureCommitmentDraftsDelivered(map.id);
  }
  if (map.current_stage === "assumptions") {
    await ensureAssumptionDraftsDelivered(map.id);
  }
  // Set-piece prose stages (walkthrough, prioritize, test_design, done):
  if (map.current_stage === "immune_system" && !map.walkthrough_delivered) {
    await ensureWalkthroughDelivered(map.id);
  }
  if (map.current_stage === "prioritize") {
    await ensurePrioritizeRecommendationDelivered(map.id);
  }
  if (map.current_stage === "test_design") {
    await ensureTestDraftDelivered(map.id);
  }
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
    <main className="min-h-screen flex flex-col">
      {/* Sticky top strip — nav bar + stage progress. Keeps the
          coachee's location in the flow visible while they scroll
          through a long map (walkthrough + assumptions can easily
          fill more than one screen). */}
      <div className="sticky top-0 z-20 bg-[color:var(--color-background)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <header className="px-4 py-3 flex items-center justify-between gap-4">
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

        <div className="px-4 py-2 border-t border-[color:var(--color-border)]/50">
          <StageProgress current={map.current_stage} />
        </div>
      </div>

      <div className="flex-1 mx-auto w-full max-w-4xl px-4 py-8 md:py-10">
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
