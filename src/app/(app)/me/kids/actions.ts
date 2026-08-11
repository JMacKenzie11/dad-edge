"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const AddSchema = z.object({
  name: z.string().min(1).max(120),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  loved: z.string().max(280).optional(),
});

export async function addKidFromMe(formData: FormData) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/me");
  const parsed = AddSchema.safeParse({
    name: formData.get("name"),
    birthdate: (formData.get("birthdate") ?? "") as string,
    loved: (formData.get("loved") ?? "") as string,
  });
  if (!parsed.success) redirect("/me/kids?error=Add+a+name");
  const supabase = await createSupabaseServerClient();
  const things_loved = parsed.data.loved?.trim() ? [parsed.data.loved.trim()] : [];
  await supabase.from("children").insert({
    user_id: user.id,
    name: parsed.data.name.trim(),
    birthdate: parsed.data.birthdate ? parsed.data.birthdate : null,
    things_loved,
  });
  redirect("/me/kids");
}

export async function removeKid(kidId: string) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/me");
  const supabase = await createSupabaseServerClient();
  await supabase.from("children").delete().eq("id", kidId).eq("user_id", user.id);
  redirect("/me/kids");
}
