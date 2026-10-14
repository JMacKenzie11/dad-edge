import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { LessonForm } from "./lesson-form";
import { LessonFiles, type AdminLessonFile } from "./lesson-files";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminLessonEditPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  await requirePlatformAdmin();
  const { id, lessonId } = await params;
  if (!UUID.test(id) || !UUID.test(lessonId)) notFound();
  const svc = createSupabaseServiceClient();

  const [{ data: course }, { data: lesson }, { data: fileData }] = await Promise.all([
    svc.from("courses").select("id, title, slug").eq("id", id).maybeSingle(),
    svc
      .from("lessons")
      .select("id, course_id, title, vimeo_url, vimeo_video_id, vimeo_hash, vimeo_thumbnail_url, vimeo_duration_seconds, description_json")
      .eq("id", lessonId)
      .eq("course_id", id)
      .maybeSingle(),
    svc
      .from("lesson_files")
      .select("id, file_name, size_bytes, sort_order")
      .eq("lesson_id", lessonId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  if (!course || !lesson) notFound();
  const c = course as { id: string; title: string; slug: string };
  const l = lesson as {
    id: string;
    title: string;
    vimeo_url: string | null;
    vimeo_video_id: string | null;
    vimeo_hash: string | null;
    vimeo_thumbnail_url: string | null;
    vimeo_duration_seconds: number | null;
    description_json: unknown;
  };
  const files = ((fileData ?? []) as Array<{ id: string; file_name: string; size_bytes: number }>).map(
    (f): AdminLessonFile => ({ id: f.id, name: f.file_name, sizeBytes: f.size_bytes }),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/courses/${c.id}`}
          className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
        >
          ← {c.title.toUpperCase()}
        </Link>
        <Link
          href={`/resources/${c.slug}/${l.id}?preview=1`}
          target="_blank"
          className="text-xs font-heading tracking-widest text-[color:var(--color-accent)] hover:underline"
        >
          PREVIEW AS MEMBER ↗
        </Link>
      </div>

      <h1 className="font-heading text-2xl">{l.title}</h1>

      <LessonForm
        lesson={{
          id: l.id,
          title: l.title,
          vimeoUrl: l.vimeo_url ?? "",
          description: l.description_json,
          video: l.vimeo_video_id
            ? { thumbnailUrl: l.vimeo_thumbnail_url, durationSeconds: l.vimeo_duration_seconds, hasHash: Boolean(l.vimeo_hash) }
            : null,
        }}
      />

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg">PDF files</h2>
          <p className="text-xs text-[color:var(--color-text-muted)]">
            PDFs only, up to 25 MB each. Members download them from the lesson page. Drag to change the order, and click a name to change what members see.
          </p>
        </div>
        <LessonFiles lessonId={l.id} files={files} />
      </section>
    </div>
  );
}
