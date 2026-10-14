"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { STALE_PAGE } from "@/lib/validation/form-error";

/**
 * Lesson completion. Only ever fired by the man's own click on the
 * lesson page; nothing in the player or anywhere else calls these.
 *
 * Writes go through the request-scoped client, so the insert policy
 * (own row, and only on a lesson he can view) is what allows it.
 */

const Uuid = z.string().uuid();

async function lessonContext(lessonId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, course_id, sort_order, courses:course_id(slug)")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) return null;
  const row = lesson as unknown as {
    id: string;
    course_id: string;
    sort_order: number;
    courses: { slug: string } | { slug: string }[] | null;
  };
  const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
  if (!course) return null;
  const { data: siblings } = await supabase
    .from("lessons")
    .select("id, sort_order, created_at")
    .eq("course_id", row.course_id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return { supabase, slug: course.slug, ids: ((siblings ?? []) as { id: string }[]).map((s) => s.id) };
}

function suffix(preview: boolean) {
  return preview ? "?preview=1" : "";
}

export async function markLessonComplete(formData: FormData) {
  const { user, readOnly } = await requireAccess();
  const lessonId = String(formData.get("lesson_id") ?? "");
  const preview = formData.get("preview") === "1" && user.is_platform_admin;
  if (!Uuid.safeParse(lessonId).success) redirect(`/resources?error=${encodeURIComponent(STALE_PAGE)}`);
  const ctx = await lessonContext(lessonId);
  if (!ctx) redirect("/resources");
  if (readOnly) redirect(`/resources/${ctx.slug}/${lessonId}${suffix(preview)}`);

  const { error } = await ctx.supabase
    .from("lesson_completions")
    .upsert({ user_id: user.id, lesson_id: lessonId }, { onConflict: "user_id,lesson_id", ignoreDuplicates: true });
  if (error) {
    const q = new URLSearchParams({ error: "That didn't save. Try again." });
    if (preview) q.set("preview", "1");
    redirect(`/resources/${ctx.slug}/${lessonId}?${q.toString()}`);
  }

  revalidatePath("/resources", "layout");
  const index = ctx.ids.indexOf(lessonId);
  const next = index >= 0 ? ctx.ids[index + 1] : undefined;
  // Next lesson in order; from the last lesson, back to the course page.
  redirect(next ? `/resources/${ctx.slug}/${next}${suffix(preview)}` : `/resources/${ctx.slug}${suffix(preview)}`);
}

export async function markLessonIncomplete(formData: FormData) {
  const { user, readOnly } = await requireAccess();
  const lessonId = String(formData.get("lesson_id") ?? "");
  const preview = formData.get("preview") === "1" && user.is_platform_admin;
  if (!Uuid.safeParse(lessonId).success) redirect("/resources");
  const ctx = await lessonContext(lessonId);
  if (!ctx) redirect("/resources");
  if (!readOnly) {
    await ctx.supabase.from("lesson_completions").delete().eq("user_id", user.id).eq("lesson_id", lessonId);
    revalidatePath("/resources", "layout");
  }
  redirect(`/resources/${ctx.slug}/${lessonId}${suffix(preview)}`);
}
