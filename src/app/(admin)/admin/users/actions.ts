"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";

const StatusSchema = z.object({
  user_id: z.string().uuid(),
  subscription_status: z.enum(["trialing", "active", "past_due", "canceled", "comped"]),
  reason: z.string().max(240).optional(),
});

export async function setSubscriptionStatus(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = StatusSchema.safeParse({
    user_id: formData.get("user_id"),
    subscription_status: formData.get("subscription_status"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) redirect(`/admin/users?error=${encodeURIComponent("Bad input.")}`);
  const svc = createSupabaseServiceClient();

  const { data: previous } = await svc
    .from("users")
    .select("subscription_status")
    .eq("id", parsed.data.user_id)
    .maybeSingle();

  const updates: Record<string, unknown> = {
    subscription_status: parsed.data.subscription_status,
    subscription_source: "manual",
  };
  if (parsed.data.subscription_status === "canceled") {
    updates.canceled_at = new Date().toISOString();
  } else {
    updates.canceled_at = null;
  }

  const { error } = await svc.from("users").update(updates).eq("id", parsed.data.user_id);
  if (error) redirect(`/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(error.message)}`);

  // Mirror on the membership: canceled users stay visible for 30 days per §5.
  if (parsed.data.subscription_status === "canceled") {
    const visibleUntil = new Date(Date.now() + 30 * 86400_000).toISOString();
    await svc
      .from("memberships")
      .update({
        status: "inactive",
        deactivated_at: new Date().toISOString(),
        canceled_visible_until: visibleUntil,
      })
      .eq("user_id", parsed.data.user_id);
  } else {
    // Reactivate memberships that were only inactive because of cancellation.
    await svc
      .from("memberships")
      .update({
        status: "active",
        deactivated_at: null,
        canceled_visible_until: null,
      })
      .eq("user_id", parsed.data.user_id)
      .eq("status", "inactive");
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "entitlement.set",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: {
      from: (previous as { subscription_status: string } | null)?.subscription_status ?? null,
      to: parsed.data.subscription_status,
      reason: parsed.data.reason ?? null,
    },
  });

  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  revalidatePath("/admin/users");
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

const AdminFlagSchema = z.object({
  user_id: z.string().uuid(),
  is_platform_admin: z.enum(["on", "off"]).transform((v) => v === "on"),
});

export async function setPlatformAdmin(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = AdminFlagSchema.safeParse({
    user_id: formData.get("user_id"),
    is_platform_admin: formData.get("is_platform_admin") ? "on" : "off",
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  await svc
    .from("users")
    .update({ is_platform_admin: parsed.data.is_platform_admin })
    .eq("id", parsed.data.user_id);
  await auditLog({
    actor_user_id: admin.id,
    action: "user.set_platform_admin",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { value: parsed.data.is_platform_admin },
  });
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}
