import { NextRequest } from "next/server";
import { addDays, format } from "date-fns";
import * as fs from "node:fs";
import * as path from "node:path";
import { streamText } from "ai";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { mainModel, mainModelIdOrUnset } from "@/lib/model-config";
import {
  getWeeklySummaryState,
  summaryAlreadyExists,
} from "@/lib/weekly-summary/state";
import { PILLARS } from "@/lib/pillars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streaming weekly-summary generator. Called by the client card on
 * first view once the grace period closes and no row exists.
 *
 * Response body is raw text with explicit section markers:
 *
 *   [HIGHLIGHT]
 *   one sentence.
 *
 *   [WHAT WORKED]
 *   two-three sentences.
 *
 *   [OPPORTUNITY]
 *   one-two forward-facing sentences.
 *
 * Client splits on the markers as text streams in — the typewriter
 * reveal is the natural rhythm of token arrival, no artificial
 * per-char delay needed. On stream close, the server parses the same
 * markers and persists the three sections to weekly_summaries so the
 * next page load is a static render.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { weekStart?: string };
  const requestedWeek = body.weekStart;

  // Re-resolve state server-side to prevent a client from POSTing an
  // arbitrary week — the summary must be for the week the state
  // resolver currently considers "generating" for this user.
  const state = await getWeeklySummaryState(user.id);
  if (state.status !== "generating") {
    return Response.json(
      { error: `summary not eligible: state=${state.status}` },
      { status: 409 },
    );
  }
  if (requestedWeek && requestedWeek !== state.weekStart) {
    return Response.json({ error: "week mismatch" }, { status: 400 });
  }
  const weekStart = state.weekStart;
  if (await summaryAlreadyExists(user.id, weekStart)) {
    return Response.json({ error: "already exists" }, { status: 409 });
  }

  // Data gathering. All queries scoped to the user; no community
  // data leaks in.
  const svc = createSupabaseServiceClient();
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    format(addDays(new Date(`${weekStart}T00:00:00Z`), i), "yyyy-MM-dd"),
  );
  const sunday = weekDates[6];

  const [
    { data: checkins },
    { data: missions },
    { data: reflections },
    { data: goals },
    { data: userRow },
  ] = await Promise.all([
    svc
      .from("daily_checkins")
      .select("date, pillar_code, value")
      .eq("user_id", user.id)
      .gte("date", weekStart)
      .lte("date", sunday),
    svc
      .from("missions")
      .select("description, status, target_date, pillar_code")
      .eq("user_id", user.id)
      .gte("target_date", weekStart)
      .lte("target_date", sunday),
    svc
      .from("daily_reflections")
      .select("date, wins, learnings")
      .eq("user_id", user.id)
      .gte("date", weekStart)
      .lte("date", sunday)
      .order("date", { ascending: true }),
    svc
      .from("quarterly_goals")
      .select("focus_area, desired_end_state, status, source")
      .eq("user_id", user.id)
      .in("status", ["active", "needs_review"]),
    svc.from("users").select("first_name").eq("id", user.id).maybeSingle(),
  ]);

  const firstName =
    (userRow as { first_name: string | null } | null)?.first_name ?? null;

  // Aggregate check-ins per pillar for the week (0-7 per pillar).
  const pillarTotals = new Map<string, number>();
  for (const r of (checkins ?? []) as {
    date: string;
    pillar_code: string;
    value: number;
  }[]) {
    if (r.value === 1) {
      pillarTotals.set(r.pillar_code, (pillarTotals.get(r.pillar_code) ?? 0) + 1);
    }
  }
  const pillarLines = PILLARS.filter((p) => p.code !== "A2").map(
    (p) => `- ${p.label} (${p.code}): ${pillarTotals.get(p.code) ?? 0}/7`,
  );

  const missionRows = ((missions ?? []) as {
    description: string;
    status: string;
    target_date: string;
    pillar_code: string;
  }[]);
  const missionsCompleted = missionRows.filter((m) => m.status === "completed").length;
  const missionsPlanned = missionRows.filter((m) => m.status !== "rolled_over").length;
  const missionSummary = missionRows.length
    ? missionRows
        .map(
          (m) =>
            `- [${m.pillar_code}] ${m.description} → ${m.status}`,
        )
        .join("\n")
    : "(no missions this week)";

  const reflectionRows = ((reflections ?? []) as {
    date: string;
    wins: string | null;
    learnings: string | null;
  }[]).filter((r) => r.wins || r.learnings);
  const reflectionText = reflectionRows.length
    ? reflectionRows
        .map((r) => {
          const parts: string[] = [`${r.date}:`];
          if (r.wins) parts.push(`  wins: ${r.wins}`);
          if (r.learnings) parts.push(`  learnings: ${r.learnings}`);
          return parts.join("\n");
        })
        .join("\n")
    : "(no reflections this week)";

  const goalLines = ((goals ?? []) as {
    focus_area: string;
    desired_end_state: string;
    status: string;
    source: string;
  }[]).map(
    (g) => `- [${g.focus_area}${g.source === "itc" ? " · ITC" : ""}] ${g.desired_end_state}`,
  );

  const voiceDoc = safeReadFile(
    path.join(process.cwd(), "docs", "coach-voice-and-tone.md"),
  );

  const system = `You write a short weekly recap for a man using the BRAVE MAN OS.

VOICE RULES (obey in full):
${voiceDoc || "(voice guide not found; default to plain, terse, honest)"}

Additional rules for this task:
- NEVER use em-dashes (—). Use commas, periods, or line breaks.
- NEVER use "read" as a noun (no "here's my read", "the honest read", "coach's read"). "Take", "call", "one thing to sharpen" are fine.
- Positively framed AND honest. Never invent wins. If the week was thin, lead with the one thing he did do and frame the gap as an opportunity, not a criticism.
- Opportunity-oriented. The closing section faces forward, not backward.
- Address him directly ("you"). No third person.
- Reference specific numbers or quotes from the data when it makes the point sharper. Don't stuff — one or two specifics beats a list.
- No emojis. No exclamation points.

OUTPUT FORMAT — emit EXACTLY these three sections, no other text before, between, or after:

[HIGHLIGHT]
One sentence. The single thing that stood out from the data.

[WHAT WORKED]
Two to three sentences. Concrete, specific, grounded in the numbers or his own reflections. Not generic praise.

[OPPORTUNITY]
One to two sentences. One thing to sharpen this coming week. Forward-facing. Never scolding.

Do not include any headers, preamble, sign-off, or extra whitespace beyond what's shown.`;

  const prompt = `NAME: ${firstName ?? "(unknown)"}
WEEK: ${weekStart} to ${sunday}

DAILY LIVING (checkins per pillar, out of 7):
${pillarLines.join("\n")}

MISSIONS THIS WEEK: ${missionsCompleted}/${missionsPlanned} completed
${missionSummary}

DAILY REFLECTIONS (his own words):
${reflectionText}

ACTIVE GOALS:
${goalLines.length ? goalLines.join("\n") : "(none active)"}

Write the recap now.`;

  const result = streamText({
    model: mainModel(),
    system,
    prompt,
    maxOutputTokens: 700,
    onFinish: async ({ text }) => {
      const parsed = parseSections(text);
      if (!parsed) {
        console.warn(
          "[weekly-summary] parse failed, not persisting. raw first 200: %s",
          text.slice(0, 200),
        );
        return;
      }
      const { error } = await svc.from("weekly_summaries").upsert({
        user_id: user.id,
        week_start: weekStart,
        body: parsed,
        model: mainModelIdOrUnset(),
      });
      if (error) {
        console.warn(
          "[weekly-summary] persist failed for user=%s week=%s: %s",
          user.id,
          weekStart,
          error.message,
        );
      }
    },
  });

  return result.toTextStreamResponse();
}

function safeReadFile(p: string): string {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Parse the model output into { highlight, what_worked, opportunity }.
 * Tolerates extra whitespace around markers. Returns null if any
 * section is missing so we don't persist a half-broken row.
 */
export function parseSections(text: string): {
  highlight: string;
  what_worked: string;
  opportunity: string;
} | null {
  const grab = (label: string, next: string | null): string | null => {
    const start = text.indexOf(`[${label}]`);
    if (start < 0) return null;
    const contentStart = start + `[${label}]`.length;
    const end = next ? text.indexOf(`[${next}]`, contentStart) : text.length;
    const slice = (end > 0 ? text.slice(contentStart, end) : text.slice(contentStart)).trim();
    return slice || null;
  };
  const highlight = grab("HIGHLIGHT", "WHAT WORKED");
  const what_worked = grab("WHAT WORKED", "OPPORTUNITY");
  const opportunity = grab("OPPORTUNITY", null);
  if (!highlight || !what_worked || !opportunity) return null;
  return { highlight, what_worked, opportunity };
}
