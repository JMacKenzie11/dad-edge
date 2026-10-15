import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { SubmitButton } from "@/components/ui/submit-button";
import { sortCourses } from "@/lib/resources/progress";
import { createCourse } from "./actions";
import { CourseList, type AdminCourseRow } from "./course-list";

export const dynamic = "force-dynamic";

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePlatformAdmin();
  const { error } = await searchParams;
  const svc = createSupabaseServiceClient();

  const { data: courseData } = await svc
    .from("courses")
    .select("id, title, slug, is_published, is_pinned, sort_order, created_at");
  const courses = sortCourses(
    (courseData ?? []) as Array<{
      id: string;
      title: string;
      slug: string;
      is_published: boolean;
      is_pinned: boolean;
      sort_order: number;
      created_at: string;
    }>,
  );

  const ids = courses.map((c) => c.id);
  const { data: lessonData } = ids.length
    ? await svc.from("lessons").select("id, course_id").in("course_id", ids)
    : { data: [] };
  const lessons = (lessonData ?? []) as { id: string; course_id: string }[];
  const { data: fileData } = lessons.length
    ? await svc.from("lesson_files").select("lesson_id").in("lesson_id", lessons.map((l) => l.id))
    : { data: [] };
  const lessonCourse = new Map(lessons.map((l) => [l.id, l.course_id]));
  const { data: visData } = ids.length
    ? await svc.from("course_communities").select("course_id").in("course_id", ids)
    : { data: [] };

  const rows: AdminCourseRow[] = courses.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    isPublished: c.is_published,
    isPinned: c.is_pinned,
    lessonCount: lessons.filter((l) => l.course_id === c.id).length,
    fileCount: ((fileData ?? []) as { lesson_id: string }[]).filter(
      (f) => lessonCourse.get(f.lesson_id) === c.id,
    ).length,
    restrictedTo: ((visData ?? []) as { course_id: string }[]).filter((v) => v.course_id === c.id).length,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl">Courses</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Courses show up for members under Resources once they&apos;re published. Pinned courses sort first. Drag to change the order members see.
        </p>
      </header>

      <form action={createCourse} className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            name="title"
            required
            minLength={2}
            maxLength={120}
            placeholder="New course title"
            aria-label="New course title"
            className="flex-1 h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
          />
          <SubmitButton label="CREATE COURSE" pendingLabel="CREATING…" />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="uses_sections" className="h-4 w-4 accent-[color:var(--color-primary)]" />
          Organize lessons into sections
          <span className="text-xs text-[color:var(--color-text-muted)]">(titled groups, like Course Introduction and Part 1)</span>
        </label>
      </form>
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}

      <CourseList courses={rows} />
    </div>
  );
}
