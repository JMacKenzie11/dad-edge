import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { localDate } from "@/lib/scoring/week";
import { addDays, format } from "date-fns";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * Reflections provider — the last 7 days of daily wins/learnings.
 * Not cacheable (updates as the man logs each night). Returns null
 * when nothing has been logged in the window.
 */
export const reflectionsProvider: ContextProvider = {
  key: "reflections",
  priority: 30,
  cacheable: false,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const today = localDate(new Date(), user.timezone);
    const sevenDaysAgo = format(
      addDays(new Date(`${today}T00:00:00`), -7),
      "yyyy-MM-dd",
    );

    const { data } = await svc
      .from("daily_reflections")
      .select("date, wins, learnings")
      .eq("user_id", user.id)
      .gte("date", sevenDaysAgo)
      .lte("date", today)
      .order("date", { ascending: false });

    const rows = ((data ?? []) as Array<{
      date: string;
      wins: string | null;
      learnings: string | null;
    }>).filter(
      (r) => (r.wins && r.wins.trim()) || (r.learnings && r.learnings.trim()),
    );

    if (rows.length === 0) return null;

    const lines = rows.map((r) => {
      const parts: string[] = [`  ${r.date}`];
      if (r.wins && r.wins.trim()) parts.push(`    Wins: ${r.wins.trim()}`);
      if (r.learnings && r.learnings.trim())
        parts.push(`    Learn: ${r.learnings.trim()}`);
      return parts.join("\n");
    });

    const text = lines.join("\n");
    return {
      label: "Daily reflections (wins / learnings — last 7 days, most recent first)",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};
