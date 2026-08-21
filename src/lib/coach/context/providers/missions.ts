import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { localDate } from "@/lib/scoring/week";
import { addDays, format } from "date-fns";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * Missions provider — this week's + next-two-week planned missions,
 * recently completed and missed, plus the last 4 weeks' on-time vs.
 * late completion rate. The completion rate is a strong signal for
 * whether the coach should push a new mission or check in on
 * follow-through first.
 *
 * Not cacheable — mission status changes daily as the man works.
 */
export const missionsProvider: ContextProvider = {
  key: "missions",
  priority: 25,
  cacheable: false,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const today = localDate(new Date(), user.timezone);
    const fourWeeksAgo = format(
      addDays(new Date(`${today}T00:00:00`), -28),
      "yyyy-MM-dd",
    );
    const twoWeeksAhead = format(
      addDays(new Date(`${today}T00:00:00`), 14),
      "yyyy-MM-dd",
    );

    const { data } = await svc
      .from("missions")
      .select(
        "id, description, pillar_code, target_date, status, completed_late, rolled_over_from_mission_id",
      )
      .eq("user_id", user.id)
      .gte("target_date", fourWeeksAgo)
      .lte("target_date", twoWeeksAhead)
      .order("target_date", { ascending: true });

    const rows = (data ?? []) as Array<{
      id: string;
      description: string;
      pillar_code: PillarCode;
      target_date: string;
      status: string;
      completed_late: boolean;
      rolled_over_from_mission_id: string | null;
    }>;

    if (rows.length === 0) return null;

    const upcoming = rows.filter(
      (m) => m.target_date >= today && m.status === "planned",
    );
    const completed = rows.filter(
      (m) => m.status === "completed" && m.target_date <= today,
    );
    const missed = rows.filter((m) => m.status === "missed");

    // 4-week completion rate (excludes rolled_over + abandoned + planned-future).
    const recentEligible = rows.filter(
      (m) =>
        m.target_date <= today &&
        (m.status === "completed" || m.status === "missed"),
    );
    const completedOnTime = recentEligible.filter(
      (m) => m.status === "completed" && !m.completed_late,
    ).length;
    const completedLate = recentEligible.filter(
      (m) => m.status === "completed" && m.completed_late,
    ).length;
    const missedCount = recentEligible.filter((m) => m.status === "missed").length;
    const totalEligible = recentEligible.length;

    const rateLine =
      totalEligible > 0
        ? `Last 4 weeks: ${completedOnTime + completedLate}/${totalEligible} completed (${completedOnTime} on time, ${completedLate} late, ${missedCount} missed)`
        : "Last 4 weeks: no missions with a decided outcome yet.";

    const upcomingLines = upcoming.length
      ? upcoming
          .slice(0, 8)
          .map(
            (m) =>
              `  - ${m.target_date} · ${PILLAR_BY_CODE[m.pillar_code].label} · ${m.description}${m.rolled_over_from_mission_id ? " (rolled over)" : ""}`,
          )
          .join("\n")
      : "  (none planned)";

    const completedLines = completed.length
      ? completed
          .slice(-5)
          .map(
            (m) =>
              `  - ${m.target_date} · ${PILLAR_BY_CODE[m.pillar_code].label} · ${m.description}${m.completed_late ? " (late)" : ""}`,
          )
          .join("\n")
      : "  (none recent)";

    const missedLines = missed.length
      ? missed
          .slice(-3)
          .map(
            (m) =>
              `  - ${m.target_date} · ${PILLAR_BY_CODE[m.pillar_code].label} · ${m.description}`,
          )
          .join("\n")
      : "  (none)";

    const text = [
      rateLine,
      "",
      "Upcoming:",
      upcomingLines,
      "Recently completed:",
      completedLines,
      "Recently missed (candidates for rollover):",
      missedLines,
    ].join("\n");

    return {
      label: "Missions",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};
