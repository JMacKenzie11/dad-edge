"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { auditLog } from "@/lib/audit";
import { assertCoachable } from "./access";
import { judgeMissingFits } from "./fit";
import { coachingWindow } from "./load";

type Result = { ok: boolean; error?: string };

const ReachSchema = z.object({
  communityId: z.string().uuid(),
  memberId: z.string().uuid(),
  note: z.string().max(2000),
});

/** Log that the viewer reached out to this man, with an optional note. */
export async function logReachOut(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = ReachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Keep the note under 2,000 characters." };
  const { communityId, memberId } = parsed.data;
  await assertCoachable(user, communityId, memberId);
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("coaching_followups")
    .insert({ community_id: communityId, member_user_id: memberId, author_user_id: user.id, note: parsed.data.note.trim() || null })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save. Try again." };
  await auditLog({ actor_user_id: user.id, action: "coaching.reach_out", target_type: "user", target_id: memberId, metadata: { community_id: communityId, followup_id: data.id } });
  revalidatePath("/admin/coaching", "layout");
  revalidatePath("/leader/coaching", "layout");
  return { ok: true };
}

/** Remove a reach-out the viewer logged (admins can remove any). */
export async function deleteReachOut(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't remove that." };
  const svc = createSupabaseServiceClient();
  const { data: row } = await svc
    .from("coaching_followups")
    .select("id, community_id, member_user_id, author_user_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Already removed." };
  await assertCoachable(user, row.community_id as string, row.member_user_id as string);
  if (row.author_user_id !== user.id && !user.is_platform_admin) return { ok: false, error: "Only the person who logged it can remove it." };
  const { error } = await svc.from("coaching_followups").delete().eq("id", row.id);
  if (error) return { ok: false, error: "Couldn't remove. Try again." };
  await auditLog({ actor_user_id: user.id, action: "coaching.reach_out_removed", target_type: "user", target_id: row.member_user_id as string, metadata: { followup_id: row.id } });
  revalidatePath("/admin/coaching", "layout");
  revalidatePath("/leader/coaching", "layout");
  return { ok: true };
}

/** Run the fit check on this man's goal-linked missions that need it. */
export async function checkFitsFor(input: unknown): Promise<Result & { judged?: number }> {
  const user = await requireUser();
  const parsed = z.object({ communityId: z.string().uuid(), memberId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false };
  await assertCoachable(user, parsed.data.communityId, parsed.data.memberId);
  const svc = createSupabaseServiceClient();
  const { data: c } = await svc.from("communities").select("id, name, timezone").eq("id", parsed.data.communityId).single();
  const window = coachingWindow(c as { id: string; name: string; timezone: string });
  const r = await judgeMissingFits(svc, { userIds: [parsed.data.memberId], from: window.from, limit: 40 });
  return { ok: r.failed === 0, judged: r.judged };
}
