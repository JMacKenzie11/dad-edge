import { notFound } from "next/navigation";
import { assertCoachable, resolveCoachingCommunity } from "@/lib/coaching/access";
import { loadCoaching } from "@/lib/coaching/load";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { auditLog } from "@/lib/audit";
import { CoachingManView } from "./man-view";
import { ReachOut } from "./reach-out";

export const dynamic = "force-dynamic";

/** One man on the Coaching page. Every open is written to the audit log. */
export default async function LeaderCoachingManPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ userId }, sp] = await Promise.all([params, searchParams]);
  const { user, community } = await resolveCoachingCommunity("leader", sp.c);
  await assertCoachable(user, community.id, userId);
  const { window, men } = await loadCoaching(createSupabaseServiceClient(), community, { viewerId: user.id, onlyUserId: userId });
  const man = men[0];
  if (!man) notFound();
  await auditLog({ actor_user_id: user.id, action: "coaching.view_member", target_type: "user", target_id: userId, metadata: { community_id: community.id } });
  return (
    <div className="space-y-6">
      <CoachingManView basePath="/leader/coaching" community={community} man={man} window={window} />
      <ReachOut
        communityId={community.id}
        memberId={man.userId}
        followups={man.followups}
        viewerId={user.id}
        viewerIsAdmin={user.is_platform_admin}
      />
    </div>
  );
}
