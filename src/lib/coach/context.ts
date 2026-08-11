import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PILLARS, PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { localDate, localMonday, weekDates } from "@/lib/scoring/week";
import { engagementStreak } from "@/lib/scoring/streaks";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import type { SessionUser } from "@/lib/session";

/**
 * §6 context injection.
 *
 * Every coach conversation opens with a compact server-built block containing
 * the man's current pillar scores + 4-week trend, streaks, this week's missions
 * with rollover chains, quarterly goals, community membership, and — where the
 * data exists — his family layer + latest Partner Connection Survey deltas.
 *
 * This is the differentiator. The coach opens from his actual data, not zero.
 *
 * Structure the output as stable Markdown so it caches cleanly. The caller
 * marks it with cache_control so subsequent turns in the same conversation
 * reuse the block. Anything volatile (turn-of-day timestamp, live message)
 * belongs outside this string.
 */
export async function buildUserContext(user: SessionUser): Promise<string> {
  const svc = createSupabaseServiceClient();
  const today = localDate(new Date(), user.timezone);
  const monday = localMonday(new Date(), user.timezone);
  const week = weekDates(monday);
  const fourWeeksAgo = format(
    addDays(new Date(`${monday}T00:00:00`), -21),
    "yyyy-MM-dd",
  );

  const twoWeeksAgo = format(
    addDays(new Date(`${today}T00:00:00`), -14),
    "yyyy-MM-dd",
  );

  const [
    { data: membership },
    { data: checkins },
    { data: missionsRaw },
    { data: goals },
    { data: partner },
    { data: children },
    { data: latestSurvey },
    { data: reflections },
  ] = await Promise.all([
    svc
      .from("memberships")
      .select("communities:community_id(name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    svc
      .from("daily_checkins")
      .select("date, pillar_code, value")
      .eq("user_id", user.id)
      .gte("date", fourWeeksAgo)
      .lte("date", today),
    svc
      .from("missions")
      .select(
        "id, description, pillar_code, target_date, status, completed_late, rolled_over_from_mission_id",
      )
      .eq("user_id", user.id)
      .gte("target_date", format(addDays(new Date(`${today}T00:00:00`), -14), "yyyy-MM-dd"))
      .lte("target_date", format(addDays(new Date(`${today}T00:00:00`), 14), "yyyy-MM-dd"))
      .order("target_date", { ascending: true }),
    svc
      .from("quarterly_goals")
      .select("focus_area, description, quarter_start, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("quarter_start", { ascending: false }),
    svc
      .from("partner_profiles")
      .select("partner_name, relationship_label, partner_birthdate, relationship_date, things_loved")
      .eq("user_id", user.id)
      .maybeSingle(),
    svc
      .from("children")
      .select("name, birthdate, things_loved")
      .eq("user_id", user.id),
    svc
      .from("partner_surveys")
      .select("id, taken_at, question_set_id")
      .eq("user_id", user.id)
      .order("taken_at", { ascending: false })
      .limit(2),
    svc
      .from("daily_reflections")
      .select("date, wins, learnings")
      .eq("user_id", user.id)
      .gte("date", twoWeeksAgo)
      .lte("date", today)
      .order("date", { ascending: false }),
  ]);

  const rows = (checkins ?? []) as { date: string; pillar_code: PillarCode; value: number }[];
  const missions = (missionsRaw ?? []) as {
    id: string;
    description: string;
    pillar_code: PillarCode;
    target_date: string;
    status: string;
    completed_late: boolean;
    rolled_over_from_mission_id: string | null;
  }[];

  const mem = membership as
    | { communities: { name: string } | { name: string }[] | null }
    | null;
  const communityName = mem?.communities
    ? Array.isArray(mem.communities)
      ? (mem.communities[0]?.name ?? null)
      : (mem.communities.name ?? null)
    : null;

  // ----- Pillars: this-week totals + 4-week rolling average per pillar -----
  const thisWeekByPillar: Record<PillarCode, number> = pillarZero();
  const priorWeeks: Record<PillarCode, number[]> = pillarBuckets();
  for (const r of rows) {
    if (r.value !== 1) continue;
    if (week.includes(r.date)) {
      thisWeekByPillar[r.pillar_code] += 1;
    } else {
      // Assign to a prior-week bucket 0..2 (older-to-newer over 3 prior weeks).
      const days = differenceInCalendarDays(
        new Date(`${monday}T00:00:00`),
        new Date(`${r.date}T00:00:00`),
      );
      const wkIdx = Math.min(2, Math.max(0, Math.floor((days - 1) / 7)));
      priorWeeks[r.pillar_code][wkIdx] += 1;
    }
  }

  const engagement = engagementStreak(
    rows.map((r) => ({ user_id: user.id, ...r })),
    today,
  );

  // ----- Missions groupings -----
  const upcoming = missions.filter(
    (m) => m.target_date >= today && m.status === "planned",
  );
  const completedRecent = missions.filter(
    (m) => m.status === "completed" && m.target_date <= today,
  );
  const missed = missions.filter(
    (m) => m.status === "missed",
  );

  // ----- Family layer -----
  const partnerData = partner as
    | {
        partner_name: string | null;
        relationship_label: string | null;
        partner_birthdate: string | null;
        relationship_date: string | null;
        things_loved: string[] | null;
      }
    | null;
  const kids = ((children ?? []) as {
    name: string;
    birthdate: string | null;
    things_loved: string[] | null;
  }[]);

  const upcomingEvents = upcomingFamilyEvents(partnerData, kids, today);

  // ----- Survey deltas -----
  const surveys = (latestSurvey ?? []) as { id: string; taken_at: string; question_set_id: string }[];
  let surveyBlock = "  No Partner Connection Survey on file.";
  if (surveys.length > 0) {
    const surveyIds = surveys.map((s) => s.id);
    const { data: responses } = await svc
      .from("partner_survey_responses")
      .select("survey_id, question_id, score, note, question:question_id(sort_order, text)")
      .in("survey_id", surveyIds);
    const bySurvey = new Map<string, Array<{ order: number; text: string; score: number; note: string | null }>>();
    for (const r of (responses ?? []) as {
      survey_id: string;
      score: number;
      note: string | null;
      question: { sort_order: number; text: string } | { sort_order: number; text: string }[] | null;
    }[]) {
      const q = Array.isArray(r.question) ? r.question[0] : r.question;
      if (!q) continue;
      let arr = bySurvey.get(r.survey_id);
      if (!arr) {
        arr = [];
        bySurvey.set(r.survey_id, arr);
      }
      arr.push({ order: q.sort_order, text: q.text, score: r.score, note: r.note });
    }

    const latest = bySurvey.get(surveys[0].id) ?? [];
    const prior = surveys[1] ? (bySurvey.get(surveys[1].id) ?? []) : [];
    latest.sort((a, b) => a.order - b.order);
    prior.sort((a, b) => a.order - b.order);

    const latestAvg = avg(latest.map((r) => r.score));
    const priorAvg = prior.length ? avg(prior.map((r) => r.score)) : null;
    const deltaLine = priorAvg !== null
      ? `Composite ${latestAvg.toFixed(1)}/5 (prior ${priorAvg.toFixed(1)}, Δ ${(latestAvg - priorAvg >= 0 ? "+" : "")}${(latestAvg - priorAvg).toFixed(1)})`
      : `Composite ${latestAvg.toFixed(1)}/5 (baseline — no prior survey)`;

    const priorByOrder = new Map(prior.map((r) => [r.order, r.score] as const));
    const perQuestion = latest
      .map((r) => {
        const p = priorByOrder.get(r.order);
        const delta = p !== undefined ? r.score - p : null;
        const arrow = delta === null ? "" : delta > 0 ? " ↑" : delta < 0 ? " ↓" : "";
        const noteFragment = r.note ? ` — “${r.note.slice(0, 120)}”` : "";
        return `  Q${r.order}: ${r.text} → ${r.score}/5${arrow}${noteFragment}`;
      })
      .join("\n");

    surveyBlock = `  Last taken ${format(new Date(surveys[0].taken_at), "yyyy-MM-dd")} · ${deltaLine}\n${perQuestion}`;
  }

  // ----- Render -----
  const pillarLines = PILLARS.map((p) => {
    const trend = priorWeeks[p.code];
    const avgPrior = trend.length ? avg(trend) : 0;
    const arrow =
      thisWeekByPillar[p.code] > avgPrior ? "↑" : thisWeekByPillar[p.code] < avgPrior ? "↓" : "→";
    return `  ${p.code === "A2" ? "A(ction)" : p.code.padEnd(2)} ${p.label.padEnd(10)} this wk ${String(thisWeekByPillar[p.code]).padStart(1)}/7  ${arrow}  (prior 3-wk avg ${avgPrior.toFixed(1)}/7)`;
  }).join("\n");

  const upcomingMissionLines = upcoming.length
    ? upcoming
        .slice(0, 8)
        .map(
          (m) =>
            `  - ${m.target_date} · ${PILLAR_BY_CODE[m.pillar_code].label} · ${m.description}${m.rolled_over_from_mission_id ? " (rolled over)" : ""}`,
        )
        .join("\n")
    : "  (none planned)";

  const completedLines = completedRecent.length
    ? completedRecent
        .slice(-5)
        .map(
          (m) =>
            `  - ${m.target_date} · ${PILLAR_BY_CODE[m.pillar_code].label} · ${m.description}${m.completed_late ? " (late)" : ""}`,
        )
        .join("\n")
    : "  (none)";

  const missedLines = missed.length
    ? missed
        .slice(-3)
        .map((m) => `  - ${m.target_date} · ${PILLAR_BY_CODE[m.pillar_code].label} · ${m.description}`)
        .join("\n")
    : "  (none)";

  const goalLines = ((goals ?? []) as {
    focus_area: PillarCode;
    description: string;
    quarter_start: string;
  }[])
    .slice(0, 4)
    .map(
      (g) =>
        `  - ${PILLAR_BY_CODE[g.focus_area].label}: ${g.description} (Q starting ${g.quarter_start})`,
    )
    .join("\n") || "  (none active)";

  const familyBlock = renderFamily(partnerData, kids, upcomingEvents);

  const reflectionRows = ((reflections ?? []) as {
    date: string;
    wins: string | null;
    learnings: string | null;
  }[]).filter((r) => (r.wins && r.wins.trim()) || (r.learnings && r.learnings.trim()));

  const reflectionBlock = reflectionRows.length === 0
    ? "  (nothing logged in the last 14 days)"
    : reflectionRows
        .slice(0, 10)
        .map((r) => {
          const winsLine = r.wins && r.wins.trim() ? `    Wins: ${r.wins.trim()}` : null;
          const learnLine = r.learnings && r.learnings.trim() ? `    Learn: ${r.learnings.trim()}` : null;
          return `  ${r.date}\n${[winsLine, learnLine].filter(Boolean).join("\n")}`;
        })
        .join("\n");

  const employmentLabel = user.employment_type
    ? {
        w2: "W2 employee",
        contract: "Contractor",
        self_employed: "Self-employed",
        business_owner: "Business owner",
        other: "Other",
      }[user.employment_type]
    : null;
  const workLine =
    [user.occupation, employmentLabel].filter(Boolean).join(" · ") || "(not on file)";

  return `# The man
Name: ${user.first_name ?? "(unknown)"} ${user.last_name ?? ""}
Timezone: ${user.timezone}
Community: ${communityName ?? "(none)"}
Work: ${workLine}
Today: ${today}
Engagement streak: ${engagement} day${engagement === 1 ? "" : "s"}

# Daily Living — this week vs 3-week trend
${pillarLines}

# Quarterly goals
${goalLines}

# Missions
Upcoming:
${upcomingMissionLines}
Recently completed:
${completedLines}
Recently missed (candidates for rollover):
${missedLines}

# Family layer
${familyBlock}

# Daily reflections (Wins / Learnings — last 14 days, most recent first)
${reflectionBlock}

# Partner Connection Survey
${surveyBlock}`;
}

function pillarZero(): Record<PillarCode, number> {
  return Object.fromEntries(PILLARS.map((p) => [p.code, 0])) as Record<PillarCode, number>;
}

function pillarBuckets(): Record<PillarCode, number[]> {
  return Object.fromEntries(PILLARS.map((p) => [p.code, [0, 0, 0]])) as Record<PillarCode, number[]>;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function renderFamily(
  partner: {
    partner_name: string | null;
    relationship_label: string | null;
    partner_birthdate: string | null;
    relationship_date: string | null;
    things_loved: string[] | null;
  } | null,
  kids: { name: string; birthdate: string | null; things_loved: string[] | null }[],
  events: { label: string; date: string; daysAway: number }[],
): string {
  const parts: string[] = [];
  if (partner?.partner_name) {
    const label = partner.relationship_label ?? "partner";
    parts.push(`  Partner: ${partner.partner_name} (${label})`);
    if (partner.things_loved && partner.things_loved.length > 0) {
      parts.push(
        `  Things he loves about her:\n${partner.things_loved
          .filter(Boolean)
          .map((t) => `    - ${t}`)
          .join("\n")}`,
      );
    }
  } else {
    parts.push("  Partner: (not on file)");
  }
  if (kids.length > 0) {
    parts.push("  Kids:");
    for (const k of kids) {
      const loves = k.things_loved && k.things_loved.length > 0
        ? ` — loves: ${k.things_loved.filter(Boolean).slice(0, 3).join("; ")}`
        : "";
      parts.push(`    - ${k.name}${k.birthdate ? ` (b. ${k.birthdate})` : ""}${loves}`);
    }
  } else {
    parts.push("  Kids: (none on file)");
  }
  if (events.length > 0) {
    parts.push("  Upcoming dates (next 45 days):");
    for (const e of events) {
      parts.push(`    - ${e.date} · ${e.label} · in ${e.daysAway} day${e.daysAway === 1 ? "" : "s"}`);
    }
  }
  return parts.join("\n");
}

function upcomingFamilyEvents(
  partner: { partner_name: string | null; partner_birthdate: string | null; relationship_date: string | null } | null,
  kids: { name: string; birthdate: string | null }[],
  todayISO: string,
): { label: string; date: string; daysAway: number }[] {
  const today = new Date(`${todayISO}T00:00:00`);
  const out: { label: string; date: string; daysAway: number }[] = [];
  const push = (label: string, monthDay: string) => {
    const [m, d] = monthDay.split("-").map(Number);
    if (!m || !d) return;
    let next = new Date(today.getFullYear(), m - 1, d);
    if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
    const daysAway = differenceInCalendarDays(next, today);
    if (daysAway <= 45) {
      out.push({ label, date: format(next, "yyyy-MM-dd"), daysAway });
    }
  };
  if (partner?.partner_birthdate) {
    push(`${partner.partner_name ?? "partner"}'s birthday`, partner.partner_birthdate.slice(5));
  }
  if (partner?.relationship_date) {
    push("anniversary", partner.relationship_date.slice(5));
  }
  for (const k of kids) {
    if (k.birthdate) push(`${k.name}'s birthday`, k.birthdate.slice(5));
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}
