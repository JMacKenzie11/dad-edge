"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const EditProfileSchema = z.object({
  first_name: z.string().max(80).optional(),
  last_name: z.string().max(80).optional(),
  city: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  avatar_data_url: z.string().max(2_500_000).optional(),
});

/**
 * Post-onboarding profile edit. Same shape as saveProfile in the
 * onboarding actions but:
 *   - Doesn't bump onboarding_step
 *   - Also lets the user edit first_name / last_name (which live on
 *     the identity step during onboarding)
 *   - Redirects back to /me on success
 */
export async function saveProfileEdit(formData: FormData) {
  const user = await requireUser();
  const parsed = EditProfileSchema.safeParse({
    first_name: (formData.get("first_name") ?? undefined) as string | undefined,
    last_name: (formData.get("last_name") ?? undefined) as string | undefined,
    city: (formData.get("city") ?? undefined) as string | undefined,
    phone: (formData.get("phone") ?? undefined) as string | undefined,
    avatar_data_url: (formData.get("avatar_data_url") ?? undefined) as
      | string
      | undefined,
  });
  if (!parsed.success) {
    redirect("/me/profile?error=Something+about+your+input+isn%27t+valid.");
  }

  const updates: Record<string, unknown> = {
    first_name: parsed.data.first_name?.trim() || null,
    last_name: parsed.data.last_name?.trim() || null,
    city: parsed.data.city?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
  };

  const dataUrl = parsed.data.avatar_data_url?.trim();
  if (dataUrl && dataUrl.startsWith("data:image/")) {
    const commaIdx = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, commaIdx);
    const [mime] = meta.split(";");
    const base64 = dataUrl.slice(commaIdx + 1);
    const bytes = Buffer.from(base64, "base64");
    const svc = createSupabaseServiceClient();
    const ext = mime === "image/png" ? "png" : "jpg";
    const path = `${user.id}/profile.${ext}`;
    const { error: uploadErr } = await svc.storage
      .from("avatars")
      .upload(path, bytes, {
        contentType: mime,
        upsert: true,
        cacheControl: "3600",
      });
    if (uploadErr) {
      console.warn("[me/profile] avatar upload failed: %s", uploadErr.message);
      redirect(
        "/me/profile?error=" +
          encodeURIComponent(`Avatar upload failed: ${uploadErr.message}`),
      );
    }
    const {
      data: { publicUrl },
    } = svc.storage.from("avatars").getPublicUrl(path);
    updates.avatar_url = `${publicUrl}?v=${Date.now()}`;
  }

  const supabase = await createSupabaseServerClient();
  await supabase.from("users").update(updates).eq("id", user.id);
  revalidatePath("/me");
  redirect("/me?saved=1");
}
