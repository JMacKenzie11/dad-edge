import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { SubmitButton } from "@/components/ui/submit-button";
import { CourseForm } from "./course-form";
import { CourseFlags } from "./course-flags";
import { groupLessonsBySection } from "@/lib/resources/progress";
import { createLesson, createSection } from "../actions";
import { LessonList, type AdminLessonRow } from "./lesson-list";
import { SectionList, SectionsToggle, type AdminSection } from "./section-list";

export const dynamic = "force-dynamic";

export default async function AdminCourseEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const svc = createSupabaseServiceClient();

  const { data: course } = await svc
    .from("courses")
    .select("id, title, slug, overview_json, is_published, is_pinned, uses_sections")
    .eq("id", id)
    .maybeSingle();
  if (!course) notFound();
  const c = course as {
    id: string;
    title: string;
    slug: string;
    overview_json: unknown;
    is_published: boolean;
    is_pinned: boolean;
    uses_sections: boolean;
  };

  const [{ data: lessonData }, { data: communityData }, { data: visData }, { data: sectionData }] = await Promise.all([
    svc
      .from("lessons")
      .select("id, section_id, title, sort_order, vimeo_video_id, vimeo_thumbnail_url, vimeo_duration_seconds")
      .eq("course_id", id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    svc.from("communities").select("id, name, status").order("name", { ascending: true }),
    svc.from("course_communities").select("community_id").eq("course_id", id),
    svc.from("course_sections").select("id, title, sort_order").eq("course_id", id).order("sort_order", { ascending: true }),
  ]);
  const lessons = (lessonData ?? []) as Array<{
    id: string;
    section_id: string | null;
    sort_order: number;
    title: string;
    vimeo_video_id: string | null;
    vimeo_thumbnail_url: string | null;
    vimeo_duration_seconds: number | null;
  }>;
  const { data: fileData } = lessons.length
    ? await svc.from("lesson_files").select("lesson_id").in("lesson_id", lessons.map((l) => l.id))
    : { data: [] };
  const filesByLesson = new Map<string, number>();
  for (const f of (fileData ?? []) as { lesson_id: string }[]) {
    filesByLesson.set(f.lesson_id, (filesByLesson.get(f.lesson_id) ?? 0) + 1);
  }
  const toRow = (l: (typeof lessons)[number]): AdminLessonRow => ({
    id: l.id,
    title: l.title,
    hasVideo: Boolean(l.vimeo_video_id),
    thumbnail: l.vimeo_thumbnail_url,
    durationSeconds: l.vimeo_duration_seconds,
    fileCount: filesByLesson.get(l.id) ?? 0,
  });
  const lessonRows = lessons.map(toRow);
  const sectionRows = (sectionData ?? []) as { id: string; title: string; sort_order: number }[];
  const sections: AdminSection[] = c.uses_sections
    ? groupLessonsBySection(sectionRows, lessons)
        .filter((g) => g.section)
        .map((g) => ({ id: g.section!.id, title: g.section!.title, lessons: g.lessons.map(toRow) }))
    : [];

  const selected = ((visData ?? []) as { community_id: string }[]).map((v) => v.community_id);
  const communities = ((communityData ?? []) as { id: string; name: string; status: string }[]).map((x) => ({
    id: x.id,
    name: x.status === "archived" ? `${x.name} (archived)` : x.name,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/courses" className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
          ← ALL COURSES
        </Link>
        <Link
          href={`/resources/${c.slug}?preview=1`}
          target="_blank"
          className="text-xs font-heading tracking-widest text-[color:var(--color-accent)] hover:underline"
        >
          PREVIEW AS MEMBER ↗
        </Link>
      </div>

      <header className="space-y-3">
        <h1 className="font-heading text-2xl">{c.title}</h1>
        <CourseFlags courseId={c.id} isPublished={c.is_published} isPinned={c.is_pinned} lessonCount={lessons.length} />
      </header>

      <CourseForm
        course={{ id: c.id, title: c.title, slug: c.slug, overview: c.overview_json }}
        communities={communities}
        selectedCommunityIds={selected}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg">Lessons</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-[color:var(--color-text-muted)]">
              {c.uses_sections ? `${sections.length} ${sections.length === 1 ? "section" : "sections"} · ` : ""}
              {lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}
            </span>
            <SectionsToggle
              courseId={c.id}
              usesSections={c.uses_sections}
              lessonCount={lessons.length}
              sectionCount={sections.length}
            />
          </div>
        </div>
        {c.uses_sections ? (
          <>
            <SectionList courseId={c.id} sections={sections} />
            <form action={createSection} className="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="course_id" value={c.id} />
              <input
                name="title"
                required
                maxLength={120}
                placeholder="New section title, like Course Introduction"
                aria-label="New section title"
                className="flex-1 h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
              />
              <SubmitButton label="ADD SECTION" pendingLabel="ADDING…" />
            </form>
          </>
        ) : (
          <>
            <LessonList courseId={c.id} lessons={lessonRows} />
            <form action={createLesson} className="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="course_id" value={c.id} />
              <input
                name="title"
                required
                minLength={2}
                maxLength={160}
                placeholder="New lesson title"
                aria-label="New lesson title"
                className="flex-1 h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
              />
              <SubmitButton label="ADD LESSON" pendingLabel="ADDING…" />
            </form>
          </>
        )}
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      </section>
    </div>
  );
}
