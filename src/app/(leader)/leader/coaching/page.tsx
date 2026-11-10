import { resolveCoachingCommunity } from "@/lib/coaching/access";
import { loadCoaching } from "@/lib/coaching/load";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { CoachingCommunityView } from "./community-view";

export const dynamic = "force-dynamic";

/** Coaching: who to reach out to and who to call out (DECISIONS.md "Coaching view"). */
export default async function LeaderCoachingPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const sp = await searchParams;
  const { user, communities, community } = await resolveCoachingCommunity("leader", sp.c);
  const { men } = await loadCoaching(createSupabaseServiceClient(), community, { viewerId: user.id });
  return (
    <CoachingCommunityView basePath="/leader/coaching" community={community} communities={communities} men={men} showPicker={false} />
  );
}
