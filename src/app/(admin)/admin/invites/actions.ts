"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/email";

const InviteSchema = z.object({
  email: z.string().email().max(200),
  first_name: z.string().max(80).optional(),
  last_name: z.string().max(80).optional(),
  community_id: z.string().uuid(),
});

export async function createInvite(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = InviteSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    first_name: (formData.get("first_name") as string) || undefined,
    last_name: (formData.get("last_name") as string) || undefined,
    community_id: formData.get("community_id"),
  });
  if (!parsed.success) redirect(`/admin/invites?error=${encodeURIComponent("Bad input.")}`);
  const svc = createSupabaseServiceClient();

  const { data: community } = await svc
    .from("communities")
    .select("name")
    .eq("id", parsed.data.community_id)
    .maybeSingle();
  if (!community) redirect(`/admin/invites?error=${encodeURIComponent("Community not found.")}`);

  const { data: existing } = await svc
    .from("invites")
    .select("id, redeemed_at")
    .eq("email", parsed.data.email)
    .eq("community_id", parsed.data.community_id)
    .maybeSingle();

  let inviteId: string;
  if (existing) {
    inviteId = (existing as { id: string }).id;
    await svc
      .from("invites")
      .update({
        first_name: parsed.data.first_name ?? null,
        last_name: parsed.data.last_name ?? null,
        invited_by: admin.id,
      })
      .eq("id", inviteId);
  } else {
    const { data: created, error } = await svc
      .from("invites")
      .insert({
        email: parsed.data.email,
        first_name: parsed.data.first_name ?? null,
        last_name: parsed.data.last_name ?? null,
        community_id: parsed.data.community_id,
        invited_by: admin.id,
      })
      .select("id")
      .single();
    if (error) redirect(`/admin/invites?error=${encodeURIComponent(error.message)}`);
    inviteId = (created as { id: string }).id;
  }

  await sendInviteEmail({
    to: parsed.data.email,
    firstName: parsed.data.first_name ?? null,
    communityName: (community as { name: string }).name,
  });

  await auditLog({
    actor_user_id: admin.id,
    action: "invite.create",
    target_type: "invite",
    target_id: inviteId,
    metadata: { email: parsed.data.email, community_id: parsed.data.community_id },
  });

  revalidatePath("/admin/invites");
  redirect("/admin/invites?saved=1");
}
