"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";

const SlugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CreateSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(2).max(60).regex(SlugRegex, "Lowercase letters, numbers, hyphens."),
  timezone: z.string().min(3).max(64),
  week_lock_days: z.coerce.number().int().min(0).max(14).default(3),
});

export async function createCommunity(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = CreateSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    timezone: formData.get("timezone") || "America/Chicago",
    week_lock_days: formData.get("week_lock_days") || 3,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    redirect(`/admin/communities?error=${encodeURIComponent(msg)}`);
  }

  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("communities")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error) redirect(`/admin/communities?error=${encodeURIComponent(error.message)}`);

  await auditLog({
    actor_user_id: admin.id,
    action: "community.create",
    target_type: "community",
    target_id: (data as { id: string }).id,
    metadata: parsed.data,
  });

  revalidatePath("/admin/communities");
  redirect(`/admin/communities/${(data as { id: string }).id}`);
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(80),
  timezone: z.string().min(3).max(64),
  week_lock_days: z.coerce.number().int().min(0).max(14),
  leaderboard_enabled: z.enum(["on", "off"]).transform((v) => v === "on"),
  missions_visible: z.enum(["on", "off"]).transform((v) => v === "on"),
  status: z.enum(["active", "archived"]),
});

export async function updateCommunity(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = UpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    week_lock_days: formData.get("week_lock_days"),
    leaderboard_enabled: formData.get("leaderboard_enabled") ? "on" : "off",
    missions_visible: formData.get("missions_visible") ? "on" : "off",
    status: formData.get("status") || "active",
  });
  if (!parsed.success) {
    redirect(`/admin/communities?error=${encodeURIComponent("Bad input.")}`);
  }
  const { id, ...updates } = parsed.data;
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("communities").update(updates).eq("id", id);
  if (error) redirect(`/admin/communities/${id}?error=${encodeURIComponent(error.message)}`);
  await auditLog({
    actor_user_id: admin.id,
    action: "community.update",
    target_type: "community",
    target_id: id,
    metadata: updates,
  });
  revalidatePath(`/admin/communities/${id}`);
  redirect(`/admin/communities/${id}?saved=1`);
}

const AssignLeaderSchema = z.object({
  community_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

export async function assignLeader(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = AssignLeaderSchema.safeParse({
    community_id: formData.get("community_id"),
    user_id: formData.get("user_id"),
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();

  const { data: existing } = await svc
    .from("memberships")
    .select("id, role, status")
    .eq("community_id", parsed.data.community_id)
    .eq("user_id", parsed.data.user_id)
    .maybeSingle();

  if (existing) {
    await svc
      .from("memberships")
      .update({ role: "leader", status: "active" })
      .eq("id", (existing as { id: string }).id);
  } else {
    await svc.from("memberships").insert({
      community_id: parsed.data.community_id,
      user_id: parsed.data.user_id,
      role: "leader",
      status: "active",
    });
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "community.assign_leader",
    target_type: "community",
    target_id: parsed.data.community_id,
    metadata: { user_id: parsed.data.user_id },
  });
  revalidatePath(`/admin/communities/${parsed.data.community_id}`);
  redirect(`/admin/communities/${parsed.data.community_id}?saved=1`);
}

const JoinSelfSchema = z.object({
  community_id: z.string().uuid(),
  role: z.enum(["leader", "member"]),
});

/**
 * Platform-admin convenience: add yourself to a community as a leader (or
 * member) with one click. Idempotent — reactivates if you'd left previously.
 */
export async function joinSelf(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = JoinSelfSchema.safeParse({
    community_id: formData.get("community_id"),
    role: formData.get("role") ?? "leader",
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();

  const { data: existing } = await svc
    .from("memberships")
    .select("id")
    .eq("community_id", parsed.data.community_id)
    .eq("user_id", admin.id)
    .maybeSingle();

  if (existing) {
    await svc
      .from("memberships")
      .update({
        role: parsed.data.role,
        status: "active",
        deactivated_at: null,
        canceled_visible_until: null,
      })
      .eq("id", (existing as { id: string }).id);
  } else {
    await svc.from("memberships").insert({
      community_id: parsed.data.community_id,
      user_id: admin.id,
      role: parsed.data.role,
      status: "active",
    });
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "community.join_self",
    target_type: "community",
    target_id: parsed.data.community_id,
    metadata: { role: parsed.data.role },
  });

  revalidatePath(`/admin/communities/${parsed.data.community_id}`);
  redirect(`/admin/communities/${parsed.data.community_id}?saved=1`);
}

const MoveMemberSchema = z.object({
  user_id: z.string().uuid(),
  from_community_id: z.string().uuid(),
  to_community_id: z.string().uuid(),
});

export async function moveMember(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = MoveMemberSchema.safeParse({
    user_id: formData.get("user_id"),
    from_community_id: formData.get("from_community_id"),
    to_community_id: formData.get("to_community_id"),
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  // Existing membership record in the source community becomes inactive but is preserved.
  await svc
    .from("memberships")
    .update({ status: "inactive", deactivated_at: new Date().toISOString() })
    .eq("user_id", parsed.data.user_id)
    .eq("community_id", parsed.data.from_community_id);
  // Upsert into destination.
  const { data: existing } = await svc
    .from("memberships")
    .select("id")
    .eq("user_id", parsed.data.user_id)
    .eq("community_id", parsed.data.to_community_id)
    .maybeSingle();
  if (existing) {
    await svc
      .from("memberships")
      .update({ status: "active", deactivated_at: null })
      .eq("id", (existing as { id: string }).id);
  } else {
    await svc.from("memberships").insert({
      user_id: parsed.data.user_id,
      community_id: parsed.data.to_community_id,
      role: "member",
      status: "active",
    });
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "community.move_member",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: {
      from: parsed.data.from_community_id,
      to: parsed.data.to_community_id,
    },
  });
  revalidatePath(`/admin/communities/${parsed.data.from_community_id}`);
  revalidatePath(`/admin/communities/${parsed.data.to_community_id}`);
  redirect(`/admin/communities/${parsed.data.to_community_id}?saved=1`);
}
