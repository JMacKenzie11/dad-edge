"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseForm, STALE_PAGE } from "@/lib/validation/form-error";
import { sanitizeDoc } from "@/lib/rich-text/doc";
import { slugify, SLUG_PATTERN } from "@/lib/resources/slug";
import { fetchVimeoMetadata, VIMEO_READ_ERROR, type VimeoMetadata } from "@/lib/resources/vimeo";
import {
  hasPdfSignature,
  LESSON_FILES_BUCKET,
  MAX_PDF_BYTES,
  storageSafeName,
  defaultDisplayName,
} from "@/lib/resources/files";

/**
 * Admin course + lesson editing. Every action re-checks platform admin
 * and writes through the service client (RLS has a matching admin-only
 * policy as the backstop). Every mutation is audit-logged.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const Uuid = z.string().uuid();

function revalidateCourse(courseId: string) {
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/resources", "layout");
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const svc = createSupabaseServiceClient();
  const root = base || "course";
  const { data } = await svc.from("courses").select("id, slug").like("slug", `${root}%`);
  const taken = new Set(
    ((data ?? []) as { id: string; slug: string }[])
      .filter((r) => r.id !== excludeId)
      .map((r) => r.slug),
  );
  if (!taken.has(root)) return root;
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const CreateCourseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the course a title of at least 2 characters.")
    .max(120, "Keep the title under 120 characters."),
});

export async function createCourse(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = parseForm(CreateCourseSchema, { title: formData.get("title") ?? "" });
  if (!parsed.ok) redirect(`/admin/courses?error=${encodeURIComponent(parsed.error)}`);

  const svc = createSupabaseServiceClient();
  const slug = await uniqueSlug(slugify(parsed.data.title));
  const { data: last } = await svc
    .from("courses")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await svc
    .from("courses")
    .insert({ title: parsed.data.title, slug, sort_order: sortOrder })
    .select("id")
    .single();
  if (error || !data) {
    redirect(`/admin/courses?error=${encodeURIComponent("The course didn't save. Try again.")}`);
  }
  const id = (data as { id: string }).id;
  await auditLog({
    actor_user_id: admin.id,
    action: "course.create",
    target_type: "course",
    target_id: id,
    metadata: { title: parsed.data.title, slug },
  });
  revalidatePath("/admin/courses");
  redirect(`/admin/courses/${id}`);
}

const UpdateCourseSchema = z.object({
  id: Uuid,
  title: z
    .string()
    .trim()
    .min(2, "Give the course a title of at least 2 characters.")
    .max(120, "Keep the title under 120 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80, "Keep the link name under 80 characters.")
    .refine((s) => s === "" || SLUG_PATTERN.test(s), "The link name can only use lowercase letters, numbers, and single hyphens."),
  visibility: z.enum(["all", "selected"]),
  community_ids: z.array(Uuid),
});

export async function updateCourse(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = parseForm(UpdateCourseSchema, {
    id: formData.get("id"),
    title: formData.get("title") ?? "",
    slug: formData.get("slug") ?? "",
    visibility: formData.get("visibility") ?? "all",
    community_ids: formData.getAll("community_ids").map(String),
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { id, title, visibility, community_ids } = parsed.data;
  if (visibility === "selected" && community_ids.length === 0) {
    return { ok: false, error: "Pick at least one community, or make the course visible to all communities." };
  }

  const svc = createSupabaseServiceClient();
  const desiredSlug = parsed.data.slug || slugify(title);
  const { data: clash } = await svc
    .from("courses")
    .select("id")
    .eq("slug", desiredSlug)
    .neq("id", id)
    .maybeSingle();
  if (clash) return { ok: false, error: `Another course already uses the link name "${desiredSlug}". Pick a different one.` };

  const overview = sanitizeDoc(formData.get("overview_json"));
  const { error } = await svc
    .from("courses")
    .update({ title, slug: desiredSlug, overview_json: overview })
    .eq("id", id);
  if (error) return { ok: false, error: "The course didn't save. Try again." };

  // Visibility: replace the rows wholesale. No rows = every community.
  await svc.from("course_communities").delete().eq("course_id", id);
  if (visibility === "selected") {
    const { error: visErr } = await svc
      .from("course_communities")
      .insert(community_ids.map((community_id) => ({ course_id: id, community_id })));
    if (visErr) return { ok: false, error: "The course saved, but the community list didn't. Save again." };
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "course.update",
    target_type: "course",
    target_id: id,
    metadata: { title, slug: desiredSlug, visibility, community_ids },
  });
  revalidateCourse(id);
  return { ok: true, message: "Saved." };
}

export async function setCourseFlag(
  courseId: string,
  flag: "is_published" | "is_pinned",
  value: boolean,
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!Uuid.safeParse(courseId).success) return { ok: false, error: STALE_PAGE };
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("courses").update({ [flag]: value }).eq("id", courseId);
  if (error) return { ok: false, error: "That change didn't save. Try again." };
  await auditLog({
    actor_user_id: admin.id,
    action: flag === "is_published" ? (value ? "course.publish" : "course.unpublish") : value ? "course.pin" : "course.unpin",
    target_type: "course",
    target_id: courseId,
  });
  revalidateCourse(courseId);
  return { ok: true };
}

export async function reorderCourses(orderedIds: string[]): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!z.array(Uuid).safeParse(orderedIds).success) return { ok: false, error: STALE_PAGE };
  const svc = createSupabaseServiceClient();
  const results = await Promise.all(
    orderedIds.map((id, i) => svc.from("courses").update({ sort_order: i }).eq("id", id)),
  );
  if (results.some((r) => r.error)) return { ok: false, error: "The new order didn't save. Refresh and try again." };
  await auditLog({ actor_user_id: admin.id, action: "course.reorder", target_type: "course", metadata: { orderedIds } });
  revalidatePath("/admin/courses");
  revalidatePath("/resources", "layout");
  return { ok: true };
}

async function storagePathsForLessons(lessonIds: string[]): Promise<string[]> {
  if (lessonIds.length === 0) return [];
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("lesson_files").select("storage_path").in("lesson_id", lessonIds);
  return ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
}

async function removeObjects(paths: string[]) {
  if (paths.length === 0) return;
  const svc = createSupabaseServiceClient();
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await svc.storage.from(LESSON_FILES_BUCKET).remove(paths.slice(i, i + 100));
    if (error) console.warn("[admin/courses] storage remove failed: %s", error.message);
  }
}

export async function deleteCourse(courseId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!Uuid.safeParse(courseId).success) return { ok: false, error: STALE_PAGE };
  const svc = createSupabaseServiceClient();
  const { data: course } = await svc.from("courses").select("title").eq("id", courseId).maybeSingle();
  const { data: lessons } = await svc.from("lessons").select("id").eq("course_id", courseId);
  const lessonIds = ((lessons ?? []) as { id: string }[]).map((l) => l.id);
  const paths = await storagePathsForLessons(lessonIds);

  const { error } = await svc.from("courses").delete().eq("id", courseId);
  if (error) return { ok: false, error: "The course didn't delete. Try again." };
  // Rows are gone (cascade); now the objects. A failure here leaves an
  // orphaned object nobody can reach, which is logged and harmless.
  await removeObjects(paths);
  await auditLog({
    actor_user_id: admin.id,
    action: "course.delete",
    target_type: "course",
    target_id: courseId,
    metadata: { title: (course as { title?: string } | null)?.title, lessons: lessonIds.length, files: paths.length },
  });
  revalidatePath("/admin/courses");
  revalidatePath("/resources", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

const CreateLessonSchema = z.object({
  course_id: Uuid,
  title: z
    .string()
    .trim()
    .min(2, "Give the lesson a title of at least 2 characters.")
    .max(160, "Keep the lesson title under 160 characters."),
});

export async function createLesson(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const courseId = String(formData.get("course_id") ?? "");
  const parsed = parseForm(CreateLessonSchema, { course_id: courseId, title: formData.get("title") ?? "" });
  if (!parsed.ok) redirect(`/admin/courses/${courseId}?error=${encodeURIComponent(parsed.error)}`);

  const svc = createSupabaseServiceClient();
  const { data: last } = await svc
    .from("lessons")
    .select("sort_order")
    .eq("course_id", parsed.data.course_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  const { data, error } = await svc
    .from("lessons")
    .insert({ course_id: parsed.data.course_id, title: parsed.data.title, sort_order: sortOrder })
    .select("id")
    .single();
  if (error || !data) {
    redirect(`/admin/courses/${courseId}?error=${encodeURIComponent("The lesson didn't save. Try again.")}`);
  }
  const id = (data as { id: string }).id;
  await auditLog({
    actor_user_id: admin.id,
    action: "lesson.create",
    target_type: "lesson",
    target_id: id,
    metadata: { course_id: parsed.data.course_id, title: parsed.data.title },
  });
  revalidateCourse(parsed.data.course_id);
  redirect(`/admin/courses/${parsed.data.course_id}/lessons/${id}`);
}

export async function reorderLessons(courseId: string, orderedIds: string[]): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!Uuid.safeParse(courseId).success || !z.array(Uuid).safeParse(orderedIds).success) {
    return { ok: false, error: STALE_PAGE };
  }
  const svc = createSupabaseServiceClient();
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      svc.from("lessons").update({ sort_order: i }).eq("id", id).eq("course_id", courseId),
    ),
  );
  if (results.some((r) => r.error)) return { ok: false, error: "The new order didn't save. Refresh and try again." };
  await auditLog({ actor_user_id: admin.id, action: "lesson.reorder", target_type: "course", target_id: courseId });
  revalidateCourse(courseId);
  return { ok: true };
}

export async function deleteLesson(lessonId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!Uuid.safeParse(lessonId).success) return { ok: false, error: STALE_PAGE };
  const svc = createSupabaseServiceClient();
  const { data: lesson } = await svc.from("lessons").select("course_id, title").eq("id", lessonId).maybeSingle();
  if (!lesson) return { ok: false, error: STALE_PAGE };
  const paths = await storagePathsForLessons([lessonId]);
  const { error } = await svc.from("lessons").delete().eq("id", lessonId);
  if (error) return { ok: false, error: "The lesson didn't delete. Try again." };
  await removeObjects(paths);
  const courseId = (lesson as { course_id: string }).course_id;
  await auditLog({
    actor_user_id: admin.id,
    action: "lesson.delete",
    target_type: "lesson",
    target_id: lessonId,
    metadata: { course_id: courseId, title: (lesson as { title: string }).title, files: paths.length },
  });
  revalidateCourse(courseId);
  return { ok: true };
}

export type VimeoPreviewResult =
  | { ok: true; video: VimeoMetadata }
  | { ok: false; error: string };

/** Live preview for the lesson editor: validates a pasted link without
 *  saving it, so the admin sees the thumbnail and duration first. */
export async function previewVimeo(url: string): Promise<VimeoPreviewResult> {
  await requirePlatformAdmin();
  if (!url || url.trim() === "") return { ok: false, error: "Paste a Vimeo link first." };
  const video = await fetchVimeoMetadata(url);
  if (!video) return { ok: false, error: VIMEO_READ_ERROR };
  return { ok: true, video };
}

const UpdateLessonSchema = z.object({
  id: Uuid,
  title: z
    .string()
    .trim()
    .min(2, "Give the lesson a title of at least 2 characters.")
    .max(160, "Keep the lesson title under 160 characters."),
  vimeo_url: z.string().trim().max(500, "That link is too long to be a Vimeo link."),
});

export type LessonSaveResult =
  | { ok: true; message: string; video: VimeoMetadata | null }
  | { ok: false; error: string };

export async function updateLesson(_prev: LessonSaveResult | null, formData: FormData): Promise<LessonSaveResult> {
  const admin = await requirePlatformAdmin();
  const parsed = parseForm(UpdateLessonSchema, {
    id: formData.get("id"),
    title: formData.get("title") ?? "",
    vimeo_url: formData.get("vimeo_url") ?? "",
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { id, title, vimeo_url } = parsed.data;

  const svc = createSupabaseServiceClient();
  const { data: existing } = await svc
    .from("lessons")
    .select("course_id, vimeo_url, vimeo_video_id, vimeo_hash, vimeo_thumbnail_url, vimeo_duration_seconds")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { ok: false, error: STALE_PAGE };
  const prev = existing as {
    course_id: string;
    vimeo_url: string | null;
    vimeo_video_id: string | null;
    vimeo_hash: string | null;
    vimeo_thumbnail_url: string | null;
    vimeo_duration_seconds: number | null;
  };

  // Every save with a link re-checks it with Vimeo. That's one fast call,
  // and it's the only way to notice a video that was deleted or had its
  // embed permission changed since the last save.
  let video: VimeoMetadata | null = null;
  const videoFields: Record<string, unknown> = {
    vimeo_url: null,
    vimeo_video_id: null,
    vimeo_hash: null,
    vimeo_thumbnail_url: null,
    vimeo_duration_seconds: null,
  };
  if (vimeo_url !== "") {
    video = await fetchVimeoMetadata(vimeo_url);
    if (!video) return { ok: false, error: VIMEO_READ_ERROR };
    Object.assign(videoFields, {
      vimeo_url,
      vimeo_video_id: video.videoId,
      vimeo_hash: video.hash,
      vimeo_thumbnail_url: video.thumbnailUrl,
      vimeo_duration_seconds: video.durationSeconds,
    });
  }

  const description = sanitizeDoc(formData.get("description_json"));
  const { error } = await svc
    .from("lessons")
    .update({ title, description_json: description, ...videoFields })
    .eq("id", id);
  if (error) return { ok: false, error: "The lesson didn't save. Try again." };

  await auditLog({
    actor_user_id: admin.id,
    action: "lesson.update",
    target_type: "lesson",
    target_id: id,
    metadata: { title, vimeo_video_id: videoFields.vimeo_video_id, had_video: Boolean(prev.vimeo_video_id) },
  });
  revalidateCourse(prev.course_id);
  revalidatePath(`/admin/courses/${prev.course_id}/lessons/${id}`);
  return { ok: true, message: "Saved.", video };
}

// ---------------------------------------------------------------------------
// Lesson files (PDF only)
// ---------------------------------------------------------------------------

export type UploadTicket =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

/**
 * Step 1 of an upload. The browser sends the file straight to Storage on
 * a one-time signed upload URL, which keeps 25 MB PDFs off our server
 * (Vercel caps request bodies far below that). The bucket itself only
 * accepts application/pdf up to 25 MB.
 */
export async function createLessonFileUpload(
  lessonId: string,
  fileName: string,
  sizeBytes: number,
): Promise<UploadTicket> {
  await requirePlatformAdmin();
  if (!Uuid.safeParse(lessonId).success) return { ok: false, error: STALE_PAGE };
  if (!/\.pdf$/i.test(fileName)) return { ok: false, error: `${fileName} isn't a PDF. Only PDF files can be attached.` };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, error: `${fileName} is empty.` };
  if (sizeBytes > MAX_PDF_BYTES) return { ok: false, error: `${fileName} is over 25 MB. Compress it or split it, then try again.` };

  const svc = createSupabaseServiceClient();
  const { data: lesson } = await svc.from("lessons").select("id").eq("id", lessonId).maybeSingle();
  if (!lesson) return { ok: false, error: STALE_PAGE };

  const path = `${lessonId}/${crypto.randomUUID()}-${storageSafeName(fileName)}`;
  const { data, error } = await svc.storage.from(LESSON_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "The upload couldn't start. Try again." };
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Step 2. Re-checks the uploaded object on the server: its real size and
 * its first bytes. The client's check is a courtesy; this one decides. A
 * file that fails is deleted from Storage before we answer.
 */
export async function finalizeLessonFile(
  lessonId: string,
  path: string,
  originalName: string,
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!Uuid.safeParse(lessonId).success || !path.startsWith(`${lessonId}/`) || path.includes("..")) {
    return { ok: false, error: STALE_PAGE };
  }
  const svc = createSupabaseServiceClient();
  const { data: signed, error: signErr } = await svc.storage
    .from(LESSON_FILES_BUCKET)
    .createSignedUrl(path, 60);
  if (signErr || !signed) return { ok: false, error: "We couldn't find the uploaded file. Try the upload again." };

  let head: Uint8Array;
  let total: number | null = null;
  try {
    const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-7" }, cache: "no-store" });
    const range = res.headers.get("content-range");
    const match = range?.match(/\/(\d+)$/);
    if (match) total = Number(match[1]);
    else if (res.status === 200) total = Number(res.headers.get("content-length") ?? NaN);
    head = new Uint8Array(await res.arrayBuffer()).slice(0, 8);
  } catch {
    await removeObjects([path]);
    return { ok: false, error: "We couldn't check the uploaded file. Try the upload again." };
  }

  if (!hasPdfSignature(head)) {
    await removeObjects([path]);
    return { ok: false, error: `${originalName} isn't a real PDF, even though the name ends in .pdf. Export it as a PDF and try again.` };
  }
  if (total == null || !Number.isFinite(total) || total <= 0 || total > MAX_PDF_BYTES) {
    await removeObjects([path]);
    return { ok: false, error: `${originalName} is over 25 MB. Compress it or split it, then try again.` };
  }

  const { data: last } = await svc
    .from("lesson_files")
    .select("sort_order")
    .eq("lesson_id", lessonId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  const { data: row, error } = await svc
    .from("lesson_files")
    .insert({
      lesson_id: lessonId,
      file_name: defaultDisplayName(originalName),
      storage_path: path,
      size_bytes: total,
      sort_order: sortOrder,
    })
    .select("id")
    .single();
  if (error || !row) {
    await removeObjects([path]);
    return { ok: false, error: "The file uploaded but didn't attach. Try again." };
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "lesson_file.upload",
    target_type: "lesson_file",
    target_id: (row as { id: string }).id,
    metadata: { lesson_id: lessonId, size_bytes: total, name: originalName },
  });
  await revalidateLessonById(lessonId);
  return { ok: true };
}

async function revalidateLessonById(lessonId: string) {
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("lessons").select("course_id").eq("id", lessonId).maybeSingle();
  const courseId = (data as { course_id: string } | null)?.course_id;
  if (courseId) {
    revalidateCourse(courseId);
    revalidatePath(`/admin/courses/${courseId}/lessons/${lessonId}`);
  }
}

const RenameSchema = z.object({
  id: Uuid,
  name: z
    .string()
    .trim()
    .min(1, "Give the file a name.")
    .max(200, "Keep the file name under 200 characters."),
});

export async function renameLessonFile(fileId: string, name: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = parseForm(RenameSchema, { id: fileId, name });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("lesson_files")
    .update({ file_name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("lesson_id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "The name didn't save. Try again." };
  await auditLog({
    actor_user_id: admin.id,
    action: "lesson_file.rename",
    target_type: "lesson_file",
    target_id: fileId,
    metadata: { name: parsed.data.name },
  });
  await revalidateLessonById((data as { lesson_id: string }).lesson_id);
  return { ok: true };
}

export async function reorderLessonFiles(lessonId: string, orderedIds: string[]): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!Uuid.safeParse(lessonId).success || !z.array(Uuid).safeParse(orderedIds).success) {
    return { ok: false, error: STALE_PAGE };
  }
  const svc = createSupabaseServiceClient();
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      svc.from("lesson_files").update({ sort_order: i }).eq("id", id).eq("lesson_id", lessonId),
    ),
  );
  if (results.some((r) => r.error)) return { ok: false, error: "The new order didn't save. Refresh and try again." };
  await auditLog({ actor_user_id: admin.id, action: "lesson_file.reorder", target_type: "lesson", target_id: lessonId });
  await revalidateLessonById(lessonId);
  return { ok: true };
}

export async function deleteLessonFile(fileId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  if (!Uuid.safeParse(fileId).success) return { ok: false, error: STALE_PAGE };
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("lesson_files")
    .select("lesson_id, storage_path, file_name")
    .eq("id", fileId)
    .maybeSingle();
  if (!data) return { ok: false, error: STALE_PAGE };
  const row = data as { lesson_id: string; storage_path: string; file_name: string };
  const { error } = await svc.from("lesson_files").delete().eq("id", fileId);
  if (error) return { ok: false, error: "The file didn't delete. Try again." };
  await removeObjects([row.storage_path]);
  await auditLog({
    actor_user_id: admin.id,
    action: "lesson_file.delete",
    target_type: "lesson_file",
    target_id: fileId,
    metadata: { lesson_id: row.lesson_id, name: row.file_name },
  });
  await revalidateLessonById(row.lesson_id);
  return { ok: true };
}
