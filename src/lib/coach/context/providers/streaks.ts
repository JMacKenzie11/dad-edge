import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import {
  localDate,
  localMonday,
  weekDates,
} from "@/lib/scoring/week";
import { engagementStreak } from "@/lib/scoring/streaks";
import { addDays, format } from "date-fns";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * Streaks + Daily Living pillar totals provider — engagement streak
 * (consecutive days with any check-in) plus per-pillar totals this
 * week vs. last week so the coach can spot a pillar that's slipping
 * without having to ask.
 *
 * Not cacheable — check-ins land daily and the totals shift by 1 per
 * pillar per day at most.
 */
export const streaksProvider: ContextProvider = {
  key: "streaks",
  priority: 15,
  cacheable: false,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const today = localDate(new Date(), user.timezone);
    const monday = localMonday(new Date(), user.timezone);
    const thisWeek = weekDates(monday);
    const lastMonday = format(
      addDays(new Date(`${monday}T00:00:00`), -7),
      "yyyy-MM-dd",
    );
    const lastWeek = weekDates(lastMonday);
    const twoWeeksAgo = lastWeek[0];

    const { data: rows } = await svc
      .from("daily_checkins")
      .select("date, pillar_code, value")
      .eq("user_id", user.id)
      .gte("date", twoWeeksAgo)
      .lte("date", today);

    const safe = (rows ?? []) as Array<{
      date: string;
      pillar_code: PillarCode;
      value: 0 | 1;
    }>;

    if (safe.length === 0) return null;

    const thisWeekTotals: Record<string, number> = {};
    const lastWeekTotals: Record<string, number> = {};
    for (const p of PILLARS) {
      thisWeekTotals[p.code] = 0;
      lastWeekTotals[p.code] = 0;
    }
    for (const r of safe) {
      if (r.value !== 1) continue;
      if (thisWeek.includes(r.date)) thisWeekTotals[r.pillar_code] += 1;
      else if (lastWeek.includes(r.date)) lastWeekTotals[r.pillar_code] += 1;
    }

    const engagement = engagementStreak(
      safe.map((r) => ({ user_id: user.id, ...r })),
      today,
    );

    const pillarLines = PILLARS.map((p) => {
      const cur = thisWeekTotals[p.code] ?? 0;
      const prev = lastWeekTotals[p.code] ?? 0;
      const arrow = cur > prev ? "↑" : cur < prev ? "↓" : "→";
      const label = p.code === "A2" ? "Action" : p.label;
      return `  ${label.padEnd(10)} this wk ${cur}/7  ${arrow}  (last wk ${prev}/7)`;
    }).join("\n");

    const text = `Engagement streak: ${engagement} day${engagement === 1 ? "" : "s"}\n${pillarLines}`;
    return {
      label: "Daily Living — this week vs last week",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};
