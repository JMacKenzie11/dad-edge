import { notFound, redirect } from "next/navigation";
import { requirePlatformAdmin, requireLeader } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { SessionUser } from "@/lib/session";

/**
 * Who may use the Coaching pages, and on which community. Platform admins:
 * any active community. Leaders: the communities they lead. The pages read
 * with the service client, so this check is the gate (the coaching tables
 * have no browser policies at all).
 */

export type CoachingScope = "admin" | "leader";
export type CoachingCommunity = { id: string; name: string; timezone: string };

export async function resolveCoachingCommunity(
  scope: CoachingScope,
  requested: string | undefined,
): Promise<{ user: SessionUser; communities: CoachingCommunity[]; community: CoachingCommunity }> {
  const svc = createSupabaseServiceClient();
  let user: SessionUser;
  let ids: string[] | null = null;
  if (scope === "admin") {
    user = await requirePlatformAdmin();
  } else {
    const r = await requireLeader();
    user = r.user;
    ids = r.leaderOf.map((c) => c.id);
    if (ids.length === 0) redirect("/today");
  }

  let q = svc
    .from("communities")
    .select("id, name, timezone")
    .eq("status", "active")
    .not("name", "ilike", "[IT-TEST]%")
    .order("name");
  if (ids) q = q.in("id", ids);
  const { data } = await q;
  const communities = (data ?? []) as CoachingCommunity[];
  if (communities.length === 0) redirect(scope === "admin" ? "/admin" : "/today");
  const community = communities.find((c) => c.id === requested) ?? communities[0];
  return { user, communities, community };
}

/** True when the viewer may coach in this community. */
export async function canCoachIn(user: SessionUser, communityId: string): Promise<boolean> {
  if (user.is_platform_admin) return true;
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("memberships")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("community_id", communityId)
    .eq("role", "leader")
    .eq("status", "active")
    .maybeSingle();
  return !!data;
}

/** The man must be an active member or leader here, and not the viewer himself. */
export async function assertCoachable(user: SessionUser, communityId: string, memberId: string): Promise<void> {
  if (memberId === user.id || !(await canCoachIn(user, communityId))) notFound();
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("memberships")
    .select("user_id, users:user_id(is_admin_only)")
    .eq("user_id", memberId)
    .eq("community_id", communityId)
    .in("role", ["member", "leader"])
    .eq("status", "active")
    .maybeSingle();
  const u = data ? (Array.isArray(data.users) ? data.users[0] : data.users) as { is_admin_only: boolean | null } | null : null;
  if (!data || u?.is_admin_only) notFound();
}
