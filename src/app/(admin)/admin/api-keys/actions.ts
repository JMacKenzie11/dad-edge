"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";
import { generateApiKey, hashApiKey, keyHint } from "@/lib/mcp/keys";

export type CreateKeyState = { key?: string; label?: string; error?: string };

const CreateSchema = z.object({
  label: z.string().trim().min(1, "Give the key a name.").max(80, "Keep the name under 80 characters."),
  community_ids: z.array(z.string().uuid()),
});

/** Make a key. The key comes back once, here, and is never stored. */
export async function createApiKey(_prev: CreateKeyState, formData: FormData): Promise<CreateKeyState> {
  const admin = await requirePlatformAdmin();
  const parsed = CreateSchema.safeParse({
    label: formData.get("label"),
    community_ids: formData.getAll("community_ids").map(String),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const key = generateApiKey();
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("api_keys")
    .insert({
      label: parsed.data.label,
      key_hash: hashApiKey(key),
      key_hint: keyHint(key),
      community_ids: parsed.data.community_ids,
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Couldn't make the key. Try again." };
  await auditLog({
    actor_user_id: admin.id,
    action: "api_key.created",
    target_type: "api_key",
    target_id: data.id,
    metadata: { label: parsed.data.label, community_ids: parsed.data.community_ids },
  });
  revalidatePath("/admin/api-keys");
  return { key, label: parsed.data.label };
}

export async function revokeApiKey(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const svc = createSupabaseServiceClient();
  await svc.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id.data).is("revoked_at", null);
  await auditLog({ actor_user_id: admin.id, action: "api_key.revoked", target_type: "api_key", target_id: id.data });
  revalidatePath("/admin/api-keys");
}
