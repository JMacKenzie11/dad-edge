import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { daysUntilQuarterEnd } from "@/lib/scoring/quarters";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * Goals provider — active quarterly goals with their start line, finish
 * line, source, and days remaining in the quarter. Not cacheable
 * because status flips (active → needs_review → completed) and the
 * countdown ticks daily.
 *
 * Returns null when the man has no active goals — a common state for
 * onboarding-in-progress or between-quarters users.
 */
export const goalsProvider: ContextProvider = {
  key: "goals",
  priority: 20,
  cacheable: false,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const { data } = await svc
      .from("quarterly_goals")
      .select(
        "focus_area, current_state, desired_end_state, quarter_start, status, source, midpoint_check_answer",
      )
      .eq("user_id", user.id)
      .in("status", ["active", "needs_review"])
      .order("quarter_start", { ascending: false });

    const rows = (data ?? []) as Array<{
      focus_area: PillarCode;
      current_state: string | null;
      desired_end_state: string;
      quarter_start: string;
      status: "active" | "needs_review";
      source: "user" | "itc";
      midpoint_check_answer: string | null;
    }>;

    if (rows.length === 0) return null;

    const daysLeft = daysUntilQuarterEnd();
    const lines = rows.slice(0, 4).map((g) => {
      const pillar = PILLAR_BY_CODE[g.focus_area].label;
      const sourceTag = g.source === "itc" ? " [ITC map]" : "";
      const reviewTag = g.status === "needs_review" ? " [needs review]" : "";
      const startFragment = g.current_state
        ? `\n    Start line: ${g.current_state}`
        : "";
      const midpointFragment = g.midpoint_check_answer
        ? `\n    Midpoint check-in: ${g.midpoint_check_answer}`
        : "";
      return `  - ${pillar}${sourceTag}${reviewTag}\n    Finish line: ${g.desired_end_state}${startFragment}${midpointFragment}`;
    });

    const header = `Days left in the quarter: ${daysLeft}`;
    const text = `${header}\n${lines.join("\n")}`;
    return {
      label: "Quarterly goals",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};
