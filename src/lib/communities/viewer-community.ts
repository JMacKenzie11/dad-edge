import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which community the Community pages show. A man can be active in
 * more than one (platform admins are in every community, migration
 * 20260824000002), and these pages used to take whichever membership
 * row came back first, so Jason saw 11am CST Braveman's leaderboard
 * when he expected the Business Owner Brotherhood (2026-10-27).
 *
 * Now: the one he picked (?c=), if he's an active member of it;
 * otherwise the one he joined first, ties broken by name, so the
 * default is the same on every visit.
 */

export type ViewerCommunity = { id: string; name: string; timezone: string; joined_at: string };

/** His active communities, in default order: joined first, then by name. */
export async function loadViewerCommunities(supabase: SupabaseClient, userId: string): Promise<ViewerCommunity[]> {
  const { data } = await supabase
    .from("memberships")
    .select("community_id, joined_at, communities:community_id(name, timezone)")
    .eq("user_id", userId)
    .eq("status", "active");
  type Row = {
    community_id: string;
    joined_at: string;
    communities: { name: string; timezone: string } | { name: string; timezone: string }[] | null;
  };
  return sortCommunities(
    ((data ?? []) as Row[]).map((r) => {
      const c = Array.isArray(r.communities) ? r.communities[0] : r.communities;
      return {
        id: r.community_id,
        name: c?.name ?? "Brothers",
        timezone: c?.timezone ?? "America/Chicago",
        joined_at: r.joined_at,
      };
    }),
  );
}

function sortCommunities(list: ViewerCommunity[]): ViewerCommunity[] {
  return [...list].sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.name.localeCompare(b.name));
}

/** The community to show: his pick if he's in it, else the default. Null when he has none. */
export function pickViewerCommunity(list: ViewerCommunity[], requested: string | undefined): ViewerCommunity | null {
  const sorted = sortCommunities(list);
  return sorted.find((c) => c.id === requested) ?? sorted[0] ?? null;
}
