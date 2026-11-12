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
export async function activeCommunities(svc: SupabaseClient): Promise<CommunityChoice[]> {
  const { data } = await svc.from("communities").select("id, name, slug").eq("status", "active").order("name");
  return (data ?? []) as CommunityChoice[];
}

/** Active communities this key may read. */
export async function communitiesFor(svc: SupabaseClient, key: ApiKeyRow): Promise<CommunityChoice[]> {
  return (await activeCommunities(svc)).filter((c) => keyCoversCommunity(key, c.id));
}

export type MemberContact = { first_name: string | null; email: string; role: "member" | "leader" };

type Row = {
  role: "member" | "leader";
  users: { first_name: string | null; email: string; subscription_status: string } | { first_name: string | null; email: string; subscription_status: string }[] | null;
};

/**
 * Active men in one community: an active membership and a subscription
 * that isn't canceled. First name and email only.
 */
export async function activeMemberContacts(svc: SupabaseClient, communityId: string): Promise<MemberContact[]> {
  const { data } = await svc
    .from("memberships")
    .select("role, users:user_id(first_name, email, subscription_status)")
    .eq("community_id", communityId)
    .eq("status", "active");
  return ((data ?? []) as Row[])
    .map((r) => ({ role: r.role, u: Array.isArray(r.users) ? r.users[0] : r.users }))
    .filter((x): x is { role: Row["role"]; u: NonNullable<typeof x.u> } => !!x.u && x.u.subscription_status !== "canceled")
    .map(({ role, u }) => ({ first_name: u.first_name, email: u.email, role }))
    .sort((a, b) => (a.first_name ?? "").localeCompare(b.first_name ?? ""));
}
