import type { SupabaseClient } from "@supabase/supabase-js";
import { hashApiKey, hashesMatch, keyCoversCommunity, type ApiKeyRow } from "./keys";
import type { CommunityChoice } from "./resolve";

/**
 * Service-role reads behind /api/mcp. Callers have already checked the
 * key; every read is audit-logged by the route.
 */

export async function findApiKey(svc: SupabaseClient, key: string): Promise<ApiKeyRow | null> {
  const hash = hashApiKey(key);
  const { data } = await svc
    .from("api_keys")
    .select("id, label, created_by, community_ids, revoked_at, key_hash")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!data || !hashesMatch(data.key_hash as string, hash) || data.revoked_at) return null;
  await svc.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return {
    id: data.id as string,
    label: data.label as string,
    created_by: (data.created_by as string | null) ?? null,
    community_ids: (data.community_ids as string[] | null) ?? [],
    revoked_at: null,
  };
}

/** Every active community. Filter with keyCoversCommunity before showing any. */
export async function activeCommunities(svc: SupabaseClient): Promise<(CommunityChoice & { timezone: string })[]> {
  const { data } = await svc.from("communities").select("id, name, slug, timezone").eq("status", "active").order("name");
  return (data ?? []) as (CommunityChoice & { timezone: string })[];
}

/** Active communities this key may read. */
export async function communitiesFor(svc: SupabaseClient, key: ApiKeyRow): Promise<CommunityChoice[]> {
  return (await activeCommunities(svc)).filter((c) => keyCoversCommunity(key, c.id));
}

export type MemberContact = { first_name: string | null; email: string; role: "member" | "leader" };

type UserFields = { first_name: string | null; last_name: string | null; email: string; subscription_status: string; is_admin_only: boolean | null; is_platform_admin: boolean | null };

export type CountedMan = { userId: string; first_name: string | null; last_name: string | null; email: string; role: "member" | "leader" };

/**
 * Who the MCP tools count as a man in a community (Jason, 2026-11-12):
 * an active membership, a subscription that isn't canceled, and not a
 * staff account. Staff means an admin-only login (never does the program)
 * or a platform admin sitting in the community as a leader, which is how
 * admins are added to every community. A platform admin who joined a
 * community as an ordinary member is counted there.
 */
export function countsAsMember(m: { status: string; role: "member" | "leader" }, u: Omit<UserFields, "first_name" | "last_name" | "email">): boolean {
  if (m.status !== "active" || u.subscription_status === "canceled") return false;
  if (u.is_admin_only) return false;
  if (u.is_platform_admin && m.role === "leader") return false;
  return true;
}

type Row = { user_id: string; role: "member" | "leader"; status: string; users: UserFields | UserFields[] | null };

export async function countedMen(svc: SupabaseClient, communityId: string): Promise<CountedMan[]> {
  const { data } = await svc
    .from("memberships")
    .select("user_id, role, status, users:user_id(first_name, last_name, email, subscription_status, is_admin_only, is_platform_admin)")
    .eq("community_id", communityId)
    .eq("status", "active");
  return ((data ?? []) as Row[])
    .map((r) => ({ r, u: Array.isArray(r.users) ? r.users[0] : r.users }))
    .filter((x): x is { r: Row; u: UserFields } => !!x.u && countsAsMember(x.r, x.u))
    .map(({ r, u }) => ({ userId: r.user_id, first_name: u.first_name, last_name: u.last_name, email: u.email, role: r.role }))
    .sort((a, b) => (a.first_name ?? "").localeCompare(b.first_name ?? ""));
}

/** First name, email and role of every man counted in one community. */
export async function activeMemberContacts(svc: SupabaseClient, communityId: string): Promise<MemberContact[]> {
  return (await countedMen(svc, communityId)).map(({ first_name, email, role }) => ({ first_name, email, role }));
}
