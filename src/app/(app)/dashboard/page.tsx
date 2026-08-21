import { Suspense } from "react";
import { requireAccess } from "@/lib/session";
import { CardSkeleton } from "./cards/card-shell";
import { PillarComparisonCard } from "./cards/pillar-comparison-card";
import { CompositeTrendCard } from "./cards/composite-trend-card";
import { SurveyDeltaCard } from "./cards/survey-delta-card";
import { MissionFollowThroughCard } from "./cards/mission-followthrough-card";
import { ItcStatusCard } from "./cards/itc-status-card";

export const dynamic = "force-dynamic";

/**
 * Personal dashboard. Server-computed, self-scoped only (no community
 * data). Each card is a separate async component wrapped in Suspense
 * so the slowest query doesn't block the whole page — you see the
 * first card as soon as its query finishes.
 */
export default async function DashboardPage() {
  const { user } = await requireAccess();
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          YOUR RECORD
        </p>
        <h1 className="font-heading text-3xl">Dashboard</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          The story your data is telling. Self only, never community.
        </p>
      </header>

      <Suspense fallback={<CardSkeleton title="Pillars this quarter vs last" />}>
        <PillarComparisonCard userId={user.id} />
      </Suspense>

      <Suspense fallback={<CardSkeleton title="Composite score trend" />}>
        <CompositeTrendCard userId={user.id} />
      </Suspense>

      <Suspense fallback={<CardSkeleton title="Partner Connection Survey" />}>
        <SurveyDeltaCard userId={user.id} />
      </Suspense>

      <Suspense fallback={<CardSkeleton title="Mission follow-through" />}>
        <MissionFollowThroughCard userId={user.id} />
      </Suspense>

      <Suspense fallback={<CardSkeleton title="ITC map" />}>
        <ItcStatusCard userId={user.id} />
      </Suspense>
    </div>
  );
}
