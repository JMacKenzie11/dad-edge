"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CreateSchema = z.object({
  mode: z.enum(["general", "mission"]),
});

/**
 * Server action: create a new coach conversation for this user and redirect
 * to its chat page.
 */
export async function createConversation(formData: FormData) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/coach?error=Read-only+account");
  const parsed = CreateSchema.safeParse({ mode: formData.get("mode") });
  if (!parsed.success) redirect("/coach?error=Pick+a+mode");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("coach_conversations")
    .insert({
      user_id: user.id,
      mode: parsed.data.mode,
    })
    .select("id")
    .single();
  if (error || !data) redirect(`/coach?error=${encodeURIComponent(error?.message ?? "Create failed.")}`);

  revalidatePath("/coach");
  redirect(`/coach/${(data as { id: string }).id}`);
}

const ArchiveSchema = z.object({
  conversation_id: z.string().uuid(),
});

export async function archiveConversation(formData: FormData) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/coach?error=Read-only+account");
  const parsed = ArchiveSchema.safeParse({ conversation_id: formData.get("conversation_id") });
  if (!parsed.success) redirect("/coach?error=Bad+input");
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("coach_conversations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.conversation_id)
    .eq("user_id", user.id);
  revalidatePath("/coach");
  redirect("/coach");
}

const RenameSchema = z.object({
  conversation_id: z.string().uuid(),
  title: z.string().min(1).max(80),
});

export async function renameConversation(formData: FormData) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return;
  const parsed = RenameSchema.safeParse({
    conversation_id: formData.get("conversation_id"),
    title: formData.get("title"),
  });
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("coach_conversations")
    .update({ title: parsed.data.title.trim() })
    .eq("id", parsed.data.conversation_id)
    .eq("user_id", user.id);
  revalidatePath(`/coach/${parsed.data.conversation_id}`);
  revalidatePath("/coach");
}
