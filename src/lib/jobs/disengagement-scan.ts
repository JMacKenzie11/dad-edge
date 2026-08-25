import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  sendDisengagementEmail,
  sendLeaderDisengagementAlert,
} from "@/lib/email";
import { classifyDisengagement, isoDateNDaysAgo } from "@/lib/scoring/disengagement";
import type { JobResult } from "@/lib/jobs/utils";

type Ladder = { day3?: boolean; day7?: boolean; day14?: boolean };

/**
 * Walk every active member and, when they hit the day-3/7/14 marks, email:
 *   - member: gentle at 3, direct at 7 (§8)
 *   - leader: outreach alert at 14
 * Deduplication: send only when daysSince matches exactly (3, 7, 14). This
 * keeps the job idempotent across days as long as it runs once daily.
 */
export async function runDisengagementScan(now: Date = new Date()): Promise<JobResult> {
  const svc = createSupabaseServiceClient();

  const { data: communities } = await svc
    .from("communities")
    .select("id, name, timezone, nudge:nudge_settings(disengagement_ladder)")
    .eq("status", "active");

  let sent = 0;
  const errors: string[] = [];
  // Cross-community dedup. A user in two communities who hit day 3
  // in one hits day 3 in the other too — same person, one email.
  // Leader alerts also dedup: if a member's day-14 rolls across two
  // communities, each leader is emailed once about that member (the
  // leader key includes their email so different leaders still hear).
  const notifiedForMember = new Set<string>();
  const notifiedLeaderForMember = new Set<string>();

  for (const c of (communities ?? []) as {
    id: string;
    name: string;
    timezone: string;
    nudge: { disengagement_ladder: Ladder } | { disengagement_ladder: Ladder }[] | null;
  }[]) {
    const ladder =
      (Array.isArray(c.nudge) ? c.nudge[0]?.disengagement_ladder : c.nudge?.disengagement_ladder) ??
      { day3: true, day7: true, day14: true };

    const { data: memberships } = await svc
      .from("memberships")
      .select("user_id, users:user_id(email, first_name)")
      .eq("community_id", c.id)
      .eq("status", "active");
    const memberIds = (memberships ?? []).map((m) => (m as { user_id: string }).user_id);
    if (memberIds.length === 0) continue;

    const { data: checkins } = await svc
      .from("daily_checkins")
      .select("user_id, date")
      .in("user_id", memberIds)
      .gte("date", isoDateNDaysAgo(30));
    const lastByUser = new Map<string, string>();
    for (const r of (checkins ?? []) as { user_id: string; date: string }[]) {
      const prev = lastByUser.get(r.user_id);
      if (!prev || r.date > prev) lastByUser.set(r.user_id, r.date);
    }

    const { data: leaders } = await svc
      .from("memberships")
      .select("users:user_id(email)")
      .eq("community_id", c.id)
      .eq("role", "leader")
      .eq("status", "active");
    const leaderEmails = ((leaders ?? []) as {
      users: { email: string } | { email: string }[] | null;
    }[])
      .map((l) => (Array.isArray(l.users) ? l.users[0]?.email : l.users?.email))
      .filter((e): e is string => Boolean(e));

    for (const m of (memberships ?? []) as {
      user_id: string;
      users: { email: string; first_name: string | null } | { email: string; first_name: string | null }[] | null;
    }[]) {
      const u = Array.isArray(m.users) ? m.users[0] : m.users;
      if (!u) continue;
      const { daysSince } = classifyDisengagement(lastByUser.get(m.user_id) ?? null, now);
      const name = u.first_name ?? u.email;

      if (daysSince === 3 && ladder.day3 !== false) {
        const key = `${m.user_id}:day3`;
        if (notifiedForMember.has(key)) continue;
        notifiedForMember.add(key);
        const res = await sendDisengagementEmail({
          to: u.email,
          firstName: u.first_name,
          daysSince,
          tone: "gentle",
        });
        res.ok ? sent++ : errors.push(`day3 ${u.email}: ${res.error}`);
      } else if (daysSince === 7 && ladder.day7 !== false) {
        const key = `${m.user_id}:day7`;
        if (notifiedForMember.has(key)) continue;
        notifiedForMember.add(key);
        const res = await sendDisengagementEmail({
          to: u.email,
          firstName: u.first_name,
          daysSince,
          tone: "direct",
        });
        res.ok ? sent++ : errors.push(`day7 ${u.email}: ${res.error}`);
      } else if (daysSince === 14 && ladder.day14 !== false) {
        for (const leaderEmail of leaderEmails) {
          const leaderKey = `${m.user_id}:day14:${leaderEmail}`;
          if (notifiedLeaderForMember.has(leaderKey)) continue;
          notifiedLeaderForMember.add(leaderKey);
          const res = await sendLeaderDisengagementAlert({
            to: leaderEmail,
            memberName: name,
            daysSince,
            communityName: c.name,
          });
          res.ok ? sent++ : errors.push(`day14-leader ${leaderEmail}: ${res.error}`);
        }
      }
    }
  }

  return { job: "disengagement-scan", ok: errors.length === 0, sent, errors };
}
