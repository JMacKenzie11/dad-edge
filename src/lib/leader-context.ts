import { redirect } from "next/navigation";
import { requireLeader } from "@/lib/admin";
import type { SessionUser } from "@/lib/session";

/**
 * Resolve which community the leader is currently acting on. Uses ?c=UUID if
 * provided (and the leader has access), otherwise defaults to their first.
 */
export async function resolveLeaderCommunity(searchParams: {
  c?: string;
}): Promise<{
  user: SessionUser;
  communityId: string;
  communityName: string;
  leaderOf: { id: string; name: string; slug: string }[];
}> {
  const { user, leaderOf } = await requireLeader();
  if (leaderOf.length === 0) redirect("/today");

  const requested = searchParams?.c;
  const chosen = requested
    ? leaderOf.find((c) => c.id === requested)
    : leaderOf[0];
  const community = chosen ?? leaderOf[0];
  return {
    user,
    communityId: community.id,
    communityName: community.name,
    leaderOf,
  };
}
