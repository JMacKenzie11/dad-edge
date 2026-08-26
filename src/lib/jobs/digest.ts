import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendDigestEmail } from "@/lib/email";
import { localMonday, weekDates } from "@/lib/scoring/week";
import { engagementStreaksByUser } from "@/lib/scoring/streaks";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { addDays, format } from "date-fns";
import type { JobResult } from "@/lib/jobs/utils";

type MemberRow = {
  userId: string;
  name: string;
  weekTotal: number;
  missionsCompleted: number;
  missionsPlanned: number;
  streak: number;
};

/**
 * Weekly community digest — generated Monday morning for the prior week (§8, §11).
 * Persists to `digests` for the record, and emails leaders + optionally the group.
 * Idempotent per (community_id, week_start).
 */
export async function runWeeklyDigest(now: Date = new Date()): Promise<JobResult> {
  const svc = createSupabaseServiceClient();

  const { data: communities } = await svc
    .from("communities")
    .select("id, name, timezone")
    .eq("status", "active")
    // Integration tests create real communities with the "[IT-TEST]"
    // prefix. Because the platform-admin auto-provision trigger adds
    // every admin as a leader of every community, an orphaned test
    // community would blast admins with a digest email. Filter here.
    .not("name", "ilike", "[IT-TEST]%");

  let sent = 0;
  let processed = 0;
  const errors: string[] = [];

  for (const c of (communities ?? []) as { id: string; name: string; timezone: string }[]) {
    const thisMonday = localMonday(now, c.timezone);
    const lastMonday = format(addDays(new Date(`${thisMonday}T00:00:00`), -7), "yyyy-MM-dd");
    const week = weekDates(lastMonday);
    const yesterday = week[6];

    // Skip if already generated for this week.
    const { data: existing } = await svc
      .from("digests")
      .select("id")
      .eq("community_id", c.id)
      .eq("week_start", lastMonday)
      .maybeSingle();
    if (existing) continue;
    processed += 1;

    const { data: memberships } = await svc
      .from("memberships")
      .select("user_id, role, users:user_id(email, first_name, last_name)")
      .eq("community_id", c.id)
      .eq("status", "active");
    const memberIds = (memberships ?? []).map((m) => (m as { user_id: string }).user_id);
    if (memberIds.length === 0) continue;

    const [{ data: rows }, { data: missions }] = await Promise.all([
      svc
        .from("daily_checkins")
        .select("user_id, date, value")
        .in("user_id", memberIds)
        .gte("date", format(addDays(new Date(`${lastMonday}T00:00:00`), -30), "yyyy-MM-dd"))
        .lte("date", yesterday),
      svc
        .from("missions")
        .select("user_id, status")
        .in("user_id", memberIds)
        .gte("target_date", lastMonday)
        .lte("target_date", yesterday),
    ]);

    const weekTotalByUser = new Map<string, number>();
    for (const r of (rows ?? []) as { user_id: string; date: string; value: number }[]) {
      if (week.includes(r.date) && r.value === 1) {
        weekTotalByUser.set(r.user_id, (weekTotalByUser.get(r.user_id) ?? 0) + 1);
      }
    }
    const missionsCompletedByUser = new Map<string, number>();
    const missionsPlannedByUser = new Map<string, number>();
    for (const m of (missions ?? []) as { user_id: string; status: string }[]) {
      missionsPlannedByUser.set(m.user_id, (missionsPlannedByUser.get(m.user_id) ?? 0) + 1);
      if (m.status === "completed") {
        missionsCompletedByUser.set(m.user_id, (missionsCompletedByUser.get(m.user_id) ?? 0) + 1);
      }
    }

    const streaks = engagementStreaksByUser(
      ((rows ?? []) as { user_id: string; date: string; pillar_code: string; value: number }[]),
      yesterday,
    );

    const members: MemberRow[] = ((memberships ?? []) as {
      user_id: string;
      users: { email: string; first_name: string | null; last_name: string | null } | { email: string; first_name: string | null; last_name: string | null }[] | null;
    }[]).map((m) => {
      const u = Array.isArray(m.users) ? m.users[0] : m.users;
      const name = u
        ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
        : m.user_id;
      return {
        userId: m.user_id,
        name,
        weekTotal: weekTotalByUser.get(m.user_id) ?? 0,
        missionsCompleted: missionsCompletedByUser.get(m.user_id) ?? 0,
        missionsPlanned: missionsPlannedByUser.get(m.user_id) ?? 0,
        streak: streaks[m.user_id] ?? 0,
      };
    });

    members.sort((a, b) => b.weekTotal - a.weekTotal);

    const body = {
      generated_at: new Date().toISOString(),
      members,
      totals: {
        member_count: members.length,
        avg_week_total: members.length
          ? Math.round(members.reduce((s, m) => s + m.weekTotal, 0) / members.length)
          : 0,
        missions_planned: members.reduce((s, m) => s + m.missionsPlanned, 0),
        missions_completed: members.reduce((s, m) => s + m.missionsCompleted, 0),
      },
    };

    const { error: insErr } = await svc.from("digests").insert({
      community_id: c.id,
      week_start: lastMonday,
      body,
    });
    if (insErr) errors.push(`insert ${c.id}: ${insErr.message}`);

    const leaders = ((memberships ?? []) as {
      user_id: string;
      role: string;
      users: { email: string } | { email: string }[] | null;
    }[])
      .filter((m) => m.role === "leader")
      .map((l) => ({
        userId: l.user_id,
        email: Array.isArray(l.users) ? l.users[0]?.email : l.users?.email,
      }))
      .filter((l): l is { userId: string; email: string } => Boolean(l.email));

    const html = renderDigestHtml(c.name, lastMonday, body);
    const text = renderDigestText(c.name, lastMonday, body);
    for (const l of leaders) {
      const res = await sendDigestEmail({
        to: l.email,
        communityName: c.name,
        weekStart: lastMonday,
        htmlBody: html,
        textBody: text,
      });
      if (res.ok) sent += 1;
      else errors.push(`digest ${l.email}: ${res.error}`);
      // Bell row for the leader. Dedup on week start so a re-run
      // that finds no existing digests row (rare edge) still can't
      // double-notify the same leader for the same week.
      await enqueueNotification({
        userId: l.userId,
        kind: "weekly_digest",
        dedupKey: lastMonday,
        title: `Weekly digest ready — ${c.name}.`,
        body: `Avg ${body.totals.avg_week_total}/49 · missions ${body.totals.missions_completed}/${body.totals.missions_planned}`,
        deepLink: "/leader",
        targetType: "digest",
      });
    }
  }

  return { job: "weekly-digest", ok: errors.length === 0, processed, sent, errors };
}

function renderDigestHtml(
  community: string,
  weekStart: string,
  body: {
    members: MemberRow[];
    totals: { avg_week_total: number; missions_completed: number; missions_planned: number };
  },
) {
  const rows = body.members
    .map(
      (m, i) => `
    <tr style="border-top:1px solid #1e2630;">
      <td style="padding:6px 8px;font-family:Archivo,Arial,sans-serif;letter-spacing:0.04em;color:${
        i < 3 ? "#0075c9" : "#fff"
      };">${i + 1}. ${escape(m.name)}</td>
      <td style="padding:6px 8px;text-align:right;">${m.weekTotal}/49</td>
      <td style="padding:6px 8px;text-align:right;color:#0075c9;">${m.missionsCompleted}/${m.missionsPlanned}</td>
      <td style="padding:6px 8px;text-align:right;color:#ff5f00;">${m.streak}d</td>
    </tr>`,
    )
    .join("");
  return `
    <p><strong>Avg week total:</strong> ${body.totals.avg_week_total}/49 ·
       <strong>Missions:</strong> ${body.totals.missions_completed}/${body.totals.missions_planned}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#fff;margin-top:12px;">
      <thead>
        <tr style="color:#9aa7b4;">
          <th style="text-align:left;padding:4px 8px;">MAN</th>
          <th style="text-align:right;padding:4px 8px;">WEEK</th>
          <th style="text-align:right;padding:4px 8px;">MISSIONS</th>
          <th style="text-align:right;padding:4px 8px;">STREAK</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderDigestText(
  community: string,
  weekStart: string,
  body: {
    members: MemberRow[];
    totals: { avg_week_total: number; missions_completed: number; missions_planned: number };
  },
) {
  const lines = body.members.map(
    (m, i) =>
      `${(i + 1).toString().padStart(2, " ")}. ${m.name.padEnd(28)} ${m.weekTotal}/49  ${m.missionsCompleted}/${m.missionsPlanned} missions  ${m.streak}d`,
  );
  return [
    `${community}: week of ${weekStart}`,
    `Avg ${body.totals.avg_week_total}/49 · Missions ${body.totals.missions_completed}/${body.totals.missions_planned}`,
    "",
    ...lines,
  ].join("\n");
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
