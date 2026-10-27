"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireLeader } from "@/lib/admin";
import { auditLog } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/scoring/week";
import { challengeFormSchema, friendlyChallengeError } from "@/lib/challenges/rules";

/**
 * Leaders set challenges for a community they lead (/leader/challenges);
 * platform admins set them for any community (/admin/challenges). Both
 * pages post here with `return_to` naming where to land afterwards.
 * Writes go through the leader's own session, so the "challenges: leader
 * manage" policy is what allows them; the edit lock and the wording sync
 * are database triggers (20261027000001_challenges.sql).
 */

export type ChallengeFormState = { error: string | null };

async function assertLeaderOf(communityId: string) {
  const { user, leaderOf } = await requireLeader();
  if (!user.is_platform_admin && !leaderOf.some((c) => c.id === communityId)) redirect("/leader");
  return user;
}

function formFields(formData: FormData) {
  return {
    name: formData.get("name"),
    pillar_code: formData.get("pillar_code"),
    mission_description: formData.get("mission_description"),
    days: formData.getAll("days"),
    target: formData.get("target"),
    starts_on: formData.get("starts_on"),
    ends_on: formData.get("ends_on"),
  };
}

const CommunityId = z.string().uuid();

/** Where the form came from: the admin page or the leader panel. */
function listPath(formData: FormData, communityId: string, query: string): string {
  return formData.get("return_to") === "admin"
    ? `/admin/challenges?${query}`
    : `/leader/challenges?c=${communityId}&${query}`;
}

function refreshLists() {
  revalidatePath("/leader/challenges");
  revalidatePath("/admin/challenges");
}

export async function createChallenge(_prev: ChallengeFormState, formData: FormData): Promise<ChallengeFormState> {
  const communityId = String(formData.get("community_id") ?? "");
  if (!CommunityId.safeParse(communityId).success) return { error: "Pick a community." };
  const user = await assertLeaderOf(communityId);
  const parsed = challengeFormSchema(localDate(new Date(), user.timezone)).safeParse(formFields(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("challenges")
    .insert({ ...parsed.data, community_id: communityId, created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { error: friendlyChallengeError(error) };
  await auditLog({
    actor_user_id: user.id,
    action: "leader.create_challenge",
    target_type: "challenge",
    target_id: data.id,
    metadata: { community_id: communityId, name: parsed.data.name },
  });
  refreshLists();
  redirect(listPath(formData, communityId, "saved=1"));
}

/**
 * Once anyone has joined, only the name and the mission wording change;
 * the other fields come in disabled and aren't sent.
 */
export async function updateChallenge(_prev: ChallengeFormState, formData: FormData): Promise<ChallengeFormState> {
  const id = String(formData.get("challenge_id") ?? "");
  if (!CommunityId.safeParse(id).success) return { error: "That challenge wasn't found." };
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("challenges")
    .select("id, community_id, pillar_code, days, target, starts_on, ends_on")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { error: "That challenge wasn't found." };
  const user = await assertLeaderOf(current.community_id);

  const locked = formData.get("locked") === "1";
  const fields = formFields(formData);
  const input = locked
    ? { ...fields, pillar_code: current.pillar_code, days: current.days.map(String), target: String(current.target), starts_on: current.starts_on, ends_on: current.ends_on }
    : fields;
  // An end date already behind the leader is fine on a running challenge
  // he's only renaming, so the "already passed" check uses the start.
  const today = localDate(new Date(), user.timezone);
  const parsed = challengeFormSchema(locked ? current.starts_on : today).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const patch = locked
    ? { name: parsed.data.name, mission_description: parsed.data.mission_description }
    : parsed.data;
  const { error } = await supabase.from("challenges").update(patch).eq("id", id);
  if (error) return { error: friendlyChallengeError(error) };
  await auditLog({
    actor_user_id: user.id,
    action: "leader.update_challenge",
    target_type: "challenge",
    target_id: id,
    metadata: { community_id: current.community_id, fields: Object.keys(patch) },
  });
  refreshLists();
  redirect(listPath(formData, current.community_id, "saved=1"));
}

export async function deleteChallenge(formData: FormData): Promise<void> {
  const id = String(formData.get("challenge_id") ?? "");
  if (!CommunityId.safeParse(id).success) return;
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase.from("challenges").select("community_id, name").eq("id", id).maybeSingle();
  if (!current) redirect("/leader/challenges");
  const user = await assertLeaderOf(current.community_id);
  await supabase.from("challenges").delete().eq("id", id);
  await auditLog({
    actor_user_id: user.id,
    action: "leader.delete_challenge",
    target_type: "challenge",
    target_id: id,
    metadata: { community_id: current.community_id, name: current.name },
  });
  refreshLists();
  redirect(listPath(formData, current.community_id, "deleted=1"));
}
