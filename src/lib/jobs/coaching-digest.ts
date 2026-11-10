import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { APP_URL, sendCoachingDigestEmail, type CoachingDigestCommunity } from "@/lib/email";
import { judgeMissingFits } from "@/lib/coaching/fit";
import { coachableIds, coachingWindow, loadCoaching, triage } from "@/lib/coaching/load";
import type { JobResult } from "@/lib/jobs/utils";

/** How many names each list carries in the email; the page has the rest. */
export const DIGEST_LIST_MAX = 5;

/**
 * Monday Coaching email (DECISIONS.md "Coaching view"). One email per
 * leader or admin, covering every community he leads, with that week's
 * Reach out and Call out lists. Leaders' links go to /leader/coaching,
 * platform admins' to /admin/coaching. One send per person per week
 * (coaching_digests), so a rerun doesn't send twice. Runs from the daily
 * cron and does nothing on other days.
 */
export async function runCoachingDigest(now: Date = new Date(), opts: { force?: boolean } = {}): Promise<JobResult> {
  if (now.getUTCDay() !== 1 && !opts.force) return { job: "coaching-digest", ok: true, processed: 0, detail: { skipped: "not Monday" } };
  const weekStart = now.toISOString().slice(0, 10);
  const svc = createSupabaseServiceClient();

  const { data: communities } = await svc
    .from("communities")
    .select("id, name, timezone")
    .eq("status", "active")
    .not("name", "ilike", "[IT-TEST]%")
    .order("name");

  type Recipient = { email: string; firstName: string | null; isAdmin: boolean; communities: CoachingDigestCommunity[] };
  const recipients = new Map<string, Recipient>();
  const errors: string[] = [];

  for (const c of (communities ?? []) as { id: string; name: string; timezone: string }[]) {
    const { data: leaders } = await svc
      .from("memberships")
      .select("user_id, users:user_id(email, first_name, is_platform_admin)")
      .eq("community_id", c.id)
      .eq("role", "leader")
      .eq("status", "active");
    type L = { user_id: string; users: { email: string; first_name: string | null; is_platform_admin: boolean } | { email: string; first_name: string | null; is_platform_admin: boolean }[] | null };
    const leaderRows = ((leaders ?? []) as L[]).map((l) => ({ id: l.user_id, u: Array.isArray(l.users) ? l.users[0] : l.users })).filter((l) => l.u?.email);
    if (leaderRows.length === 0) continue;

    // Fresh fit calls before the lists are built.
    const ids = (await coachableIds(svc, c.id, null)).map((m) => m.userId);
    if (ids.length === 0) continue;
    await judgeMissingFits(svc, { userIds: ids, from: coachingWindow(c, now).from, limit: 100 });
    const { men } = await loadCoaching(svc, c, { viewerId: null, now });

    for (const l of leaderRows) {
      // A leader isn't told to reach out to himself.
      const { reachOut, callOut } = triage(men.filter((m) => m.userId !== l.id), now);
      const r = recipients.get(l.id) ?? { email: l.u!.email, firstName: l.u!.first_name, isAdmin: l.u!.is_platform_admin, communities: [] };
      r.communities.push({
        name: c.name,
        url: `${APP_URL}/${r.isAdmin ? "admin" : "leader"}/coaching?c=${c.id}`,
        reachOut: reachOut.slice(0, DIGEST_LIST_MAX).map((m) => ({ name: m.name, line: m.signals.flags[0].line, question: m.signals.flags[0].question })),
        callOut: callOut.slice(0, DIGEST_LIST_MAX).map((m) => ({ name: m.name, line: m.signals.wins[0].line })),
      });
      recipients.set(l.id, r);
    }
  }

  let sent = 0;
  for (const [userId, r] of recipients) {
    const withNames = r.communities.filter((c) => c.reachOut.length + c.callOut.length > 0);
    if (withNames.length === 0) continue;
    // Claim the week first, so two overlapping runs can't both send.
    const { error: claimErr } = await svc.from("coaching_digests").insert({ user_id: userId, week_start: weekStart });
    if (claimErr) {
      if (claimErr.code !== "23505") errors.push(`${userId}: ${claimErr.message}`);
      continue;
    }
    const res = await sendCoachingDigestEmail({ to: r.email, firstName: r.firstName, communities: withNames });
    if (res.ok) sent += 1;
    else {
      errors.push(`${userId}: ${res.error}`);
      await svc.from("coaching_digests").delete().eq("user_id", userId).eq("week_start", weekStart);
    }
  }
  return { job: "coaching-digest", ok: errors.length === 0, processed: recipients.size, sent, errors };
}
