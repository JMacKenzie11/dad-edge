import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * ITC provider — conditional. Returns null unless the man's
 * itc_participants row is linked to his users.id AND he has an
 * in-progress map. When present, surfaces current stage + the next
 * running test's target date.
 *
 * Not cacheable — the map stage changes as the coachee advances
 * through the ITC flow.
 */
export const itcProvider: ContextProvider = {
  key: "itc",
  priority: 35,
  cacheable: false,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();

    const { data: participant } = await svc
      .from("itc_participants")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!participant) return null;
    const participantId = (participant as { id: string }).id;

    const { data: maps } = await svc
      .from("itc_maps")
      .select("id, current_stage, pillar_code")
      .eq("participant_id", participantId)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(1);
    const active = ((maps ?? []) as Array<{
      id: string;
      current_stage: string;
      pillar_code: PillarCode;
    }>)[0];
    if (!active) return null;

    const { data: runningTest } = await svc
      .from("itc_tests")
      .select("id, target_date")
      .eq("map_id", active.id)
      .eq("status", "designed")
      .order("target_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    const pillarLabel = PILLAR_BY_CODE[active.pillar_code].label;
    const stageLabel = active.current_stage
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const testLine = (runningTest as { target_date: string } | null)?.target_date
      ? `Test scheduled by ${(runningTest as { target_date: string }).target_date}`
      : "No test currently running.";

    const text = `Pillar: ${pillarLabel}\nStage: ${stageLabel}\n${testLine}\nMap id: ${active.id}`;
    return {
      label: "ITC map (in progress)",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};
