import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/session";

/**
 * Platform admin gate — used by every (admin) route.
 * Non-admins are redirected to /today rather than shown a 403 to avoid
 * confirming that /admin exists as a surface.
 */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.is_platform_admin) redirect("/today");
  return user;
}

/**
 * Leader gate — must be an active leader of at least one community.
 * Returns the user and the list of communities they lead.
 */
export async function requireLeader(): Promise<{
  user: SessionUser;
  leaderOf: { id: string; name: string; slug: string }[];
}> {
  const user = await requireUser();
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memberships")
    .select("community_id, communities:community_id(id, name, slug)")
    .eq("user_id", user.id)
    .eq("role", "leader")
    .eq("status", "active");

  const communities = (data ?? [])
    .map((r) => {
      const c = r.communities as unknown;
      if (Array.isArray(c)) return c[0] as { id: string; name: string; slug: string } | undefined;
      return c as { id: string; name: string; slug: string } | undefined;
    })
    .filter((c): c is { id: string; name: string; slug: string } => Boolean(c));

  if (communities.length === 0 && !user.is_platform_admin) redirect("/today");
  return { user, leaderOf: communities };
}
