"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";

const ResolveSchema = z.object({
  flag_id: z.string().uuid(),
  notes: z.string().max(400).optional(),
});

export async function resolveFlag(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = ResolveSchema.safeParse({
    flag_id: formData.get("flag_id"),
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  await svc
    .from("coach_flags_queue")
    .update({
      status: "reviewed",
      reviewed_by: admin.id,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.flag_id);
  await auditLog({
    actor_user_id: admin.id,
    action: "coach_flag.resolve",
    target_type: "coach_flag",
    target_id: parsed.data.flag_id,
    metadata: { notes: parsed.data.notes ?? null },
  });
  revalidatePath("/admin/coach-flags");
  redirect("/admin/coach-flags");
}
