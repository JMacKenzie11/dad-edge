import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { DashboardCard } from "./card-shell";

/**
 * Card 3.5 — ITC status, conditional. Returns null (renders nothing)
 * when the user has no linked ITC participant or no in-progress
 * map, per spec ("omit the card entirely, don't render empty").
 * Uses the service client because itc_participants + itc_maps live
 * outside the main-app user RLS scope.
 */
export async function ItcStatusCard({
  userId,
}: {
  userId: string;
}): Promise<React.ReactNode | null> {
  const svc = createSupabaseServiceClient();
  const { data: participant } = await svc
    .from("itc_participants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!participant) return null;

  const { data: maps } = await svc
    .from("itc_maps")
    .select("id, current_stage, pillar_code, status")
    .eq("participant_id", participant.id)
    .eq("status", "in_progress")
    .order("updated_at", { ascending: false })
    .limit(1);

  const active = ((maps ?? []) as Array<{
    id: string;
    current_stage: string;
    pillar_code: PillarCode;
    status: string;
  }>)[0];

  if (!active) return null;

  // If a test is running, surface its target date.
  const { data: runningTest } = await svc
    .from("itc_tests")
    .select("id, target_date")
    .eq("map_id", active.id)
    .eq("status", "designed")
    .order("target_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const p = PILLAR_BY_CODE[active.pillar_code];
  const stageLabel = active.current_stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <DashboardCard title="Improvement map">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 inline-block h-8 w-1.5 rounded-full"
          style={{ background: p.colorVar }}
          aria-hidden
        />
        <div className="flex-1">
          <p className="text-sm">
            <span className="font-semibold">{p.label}</span> · currently at{" "}
            <span className="text-[color:var(--color-primary)]">{stageLabel}</span>
          </p>
          {runningTest ? (
            <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
              Test scheduled by {runningTest.target_date}
            </p>
          ) : null}
          <Link
            href={`/itc/${active.id}`}
            className="inline-block text-xs text-[color:var(--color-primary)] mt-2 hover:underline"
          >
            Open the map →
          </Link>
        </div>
      </div>
    </DashboardCard>
  );
}
