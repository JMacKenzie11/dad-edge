"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireLeader } from "@/lib/admin";
import { auditLog } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/email";

/**
 * Assert the acting user leads the given community. Redirects to /today otherwise.
 */
async function assertLeaderOf(communityId: string) {
  const { user, leaderOf } = await requireLeader();
  const owns = user.is_platform_admin || leaderOf.some((c) => c.id === communityId);
  if (!owns) redirect("/today");
  return user;
}

const InviteSchema = z.object({
  community_id: z.string().uuid(),
  email: z.string().email().max(200),
  first_name: z.string().max(80).optional(),
  last_name: z.string().max(80).optional(),
});

export async function leaderInvite(formData: FormData) {
  const parsed = InviteSchema.safeParse({
    community_id: formData.get("community_id"),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    first_name: (formData.get("first_name") as string) || undefined,
    last_name: (formData.get("last_name") as string) || undefined,
  });
  if (!parsed.success) redirect(`/leader/members?error=${encodeURIComponent("Bad input.")}`);
  const leader = await assertLeaderOf(parsed.data.community_id);
  const svc = createSupabaseServiceClient();

  const { data: community } = await svc
    .from("communities")
    .select("name")
    .eq("id", parsed.data.community_id)
    .maybeSingle();
  if (!community) redirect(`/leader/members?error=${encodeURIComponent("Community not found.")}`);

  const { data: existing } = await svc
    .from("invites")
    .select("id")
    .eq("email", parsed.data.email)
    .eq("community_id", parsed.data.community_id)
    .maybeSingle();

  let inviteId: string;
  if (existing) {
    inviteId = (existing as { id: string }).id;
  } else {
    const { data, error } = await svc
      .from("invites")
      .insert({
        email: parsed.data.email,
        first_name: parsed.data.first_name ?? null,
        last_name: parsed.data.last_name ?? null,
        community_id: parsed.data.community_id,
        invited_by: leader.id,
      })
      .select("id")
      .single();
    if (error) redirect(`/leader/members?c=${parsed.data.community_id}&error=${encodeURIComponent(error.message)}`);
    inviteId = (data as { id: string }).id;
  }

  await sendInviteEmail({
    to: parsed.data.email,
    firstName: parsed.data.first_name ?? null,
    communityName: (community as { name: string }).name,
  });

  await auditLog({
    actor_user_id: leader.id,
    action: "leader.invite",
    target_type: "invite",
    target_id: inviteId,
    metadata: { email: parsed.data.email, community_id: parsed.data.community_id },
  });

  revalidatePath("/leader/members");
  redirect(`/leader/members?c=${parsed.data.community_id}&saved=1`);
}

const DeactivateSchema = z.object({
  community_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

export async function deactivateMember(formData: FormData) {
  const parsed = DeactivateSchema.safeParse({
    community_id: formData.get("community_id"),
    user_id: formData.get("user_id"),
  });
  if (!parsed.success) return;
  const leader = await assertLeaderOf(parsed.data.community_id);
  const svc = createSupabaseServiceClient();
  await svc
    .from("memberships")
    .update({
      status: "inactive",
      deactivated_at: new Date().toISOString(),
      canceled_visible_until: new Date(Date.now() + 30 * 86400_000).toISOString(),
    })
    .eq("community_id", parsed.data.community_id)
    .eq("user_id", parsed.data.user_id);
  await auditLog({
    actor_user_id: leader.id,
    action: "leader.deactivate_member",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { community_id: parsed.data.community_id },
  });
  revalidatePath("/leader/members");
  redirect(`/leader/members?c=${parsed.data.community_id}&saved=1`);
}

export async function reactivateMember(formData: FormData) {
  const parsed = DeactivateSchema.safeParse({
    community_id: formData.get("community_id"),
    user_id: formData.get("user_id"),
  });
  if (!parsed.success) return;
  const leader = await assertLeaderOf(parsed.data.community_id);
  const svc = createSupabaseServiceClient();
  await svc
    .from("memberships")
    .update({ status: "active", deactivated_at: null, canceled_visible_until: null })
    .eq("community_id", parsed.data.community_id)
    .eq("user_id", parsed.data.user_id);
  await auditLog({
    actor_user_id: leader.id,
    action: "leader.reactivate_member",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { community_id: parsed.data.community_id },
  });
  revalidatePath("/leader/members");
  redirect(`/leader/members?c=${parsed.data.community_id}&saved=1`);
}

const NudgeSchema = z.object({
  community_id: z.string().uuid(),
  daily_reminder_time: z.string().regex(/^\d{2}:\d{2}$/),
  day3: z.enum(["on", "off"]).transform((v) => v === "on"),
  day7: z.enum(["on", "off"]).transform((v) => v === "on"),
  day14: z.enum(["on", "off"]).transform((v) => v === "on"),
});

export async function updateNudgeSettings(formData: FormData) {
  const parsed = NudgeSchema.safeParse({
    community_id: formData.get("community_id"),
    daily_reminder_time: formData.get("daily_reminder_time"),
    day3: formData.get("day3") ? "on" : "off",
    day7: formData.get("day7") ? "on" : "off",
    day14: formData.get("day14") ? "on" : "off",
  });
  if (!parsed.success) return;
  const leader = await assertLeaderOf(parsed.data.community_id);
  const svc = createSupabaseServiceClient();
  await svc.from("nudge_settings").upsert({
    community_id: parsed.data.community_id,
    daily_reminder_time: parsed.data.daily_reminder_time,
    disengagement_ladder: {
      day3: parsed.data.day3,
      day7: parsed.data.day7,
      day14: parsed.data.day14,
    },
  });
  await auditLog({
    actor_user_id: leader.id,
    action: "leader.nudge_settings.update",
    target_type: "community",
    target_id: parsed.data.community_id,
  });
  revalidatePath("/leader/nudges");
  redirect(`/leader/nudges?c=${parsed.data.community_id}&saved=1`);
}

const CorrectionSchema = z.object({
  community_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]),
  new_value: z.enum(["0", "1", "clear"]),
  reason: z.string().min(4).max(400),
});

export async function submitCorrection(formData: FormData) {
  const parsed = CorrectionSchema.safeParse({
    community_id: formData.get("community_id"),
    target_user_id: formData.get("target_user_id"),
    date: formData.get("date"),
    pillar_code: formData.get("pillar_code"),
    new_value: formData.get("new_value"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect(`/leader/corrections?error=${encodeURIComponent("Bad input.")}`);
  }
  if (parsed.data.pillar_code === "A2") {
    redirect(
      `/leader/corrections?c=${parsed.data.community_id}&error=${encodeURIComponent(
        "Action is derived from mission completion — correct the mission instead.",
      )}`,
    );
  }
  const leader = await assertLeaderOf(parsed.data.community_id);
  const svc = createSupabaseServiceClient();

  const { data: existing } = await svc
    .from("daily_checkins")
    .select("id, value")
    .eq("user_id", parsed.data.target_user_id)
    .eq("date", parsed.data.date)
    .eq("pillar_code", parsed.data.pillar_code)
    .maybeSingle();
  const oldValue = existing ? (existing as { value: number }).value : null;
  const newValueNum = parsed.data.new_value === "clear" ? null : Number(parsed.data.new_value);

  if (parsed.data.new_value === "clear") {
    if (existing) await svc.from("daily_checkins").delete().eq("id", (existing as { id: string }).id);
  } else if (existing) {
    await svc
      .from("daily_checkins")
      .update({ value: newValueNum, edited_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
  } else {
    await svc.from("daily_checkins").insert({
      user_id: parsed.data.target_user_id,
      date: parsed.data.date,
      pillar_code: parsed.data.pillar_code,
      value: newValueNum,
    });
  }

  await svc.from("score_corrections").insert({
    admin_user_id: leader.id,
    target_user_id: parsed.data.target_user_id,
    date: parsed.data.date,
    pillar_code: parsed.data.pillar_code,
    old_value: oldValue,
    new_value: newValueNum,
    reason: parsed.data.reason,
  });

  await auditLog({
    actor_user_id: leader.id,
    action: "leader.correction",
    target_type: "user",
    target_id: parsed.data.target_user_id,
    metadata: {
      date: parsed.data.date,
      pillar_code: parsed.data.pillar_code,
      old_value: oldValue,
      new_value: newValueNum,
      reason: parsed.data.reason,
    },
  });

  revalidatePath("/leader/corrections");
  redirect(`/leader/corrections?c=${parsed.data.community_id}&saved=1`);
}
