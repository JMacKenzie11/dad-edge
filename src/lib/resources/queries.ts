import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderLessons, sortCourses } from "./progress";

/**
 * Member-side reads for the resource library. Every query here runs on the
 * request-scoped client, so RLS (can_view_course: published, visible to one
 * of his communities, entitled) decides what comes back. Pages also call
 * requireAccess() first; the two gates agree by construction.
 *
 * `preview` is honored only for platform admins (RLS already lets them read
 * drafts); for everyone else drafts are filtered out here as well as by RLS.
 */

export type CourseRow = {
  id: string;
  title: string;
  slug: string;
  overview_json: unknown;
  is_published: boolean;
  is_pinned: boolean;
  uses_sections: boolean;
  sort_order: number;
  created_at: string;
};

export type SectionRow = {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
};

export type LessonRow = {
  id: string;
  course_id: string;
  section_id: string | null;
  title: string;
  sort_order: number;
  vimeo_video_id: string | null;
  vimeo_hash: string | null;
  vimeo_thumbnail_url: string | null;
  vimeo_duration_seconds: number | null;
  description_json: unknown;
};

export type LessonFileRow = {
  id: string;
  lesson_id: string;
  file_name: string;
  size_bytes: number;
  sort_order: number;
};

export type LibraryCourse = CourseRow & {
  lessonCount: number;
  coverThumbnail: string | null;
  completedCount: number;
};

const COURSE_COLUMNS = "id, title, slug, overview_json, is_published, is_pinned, uses_sections, sort_order, created_at";
const LESSON_COLUMNS =
  "id, course_id, section_id, title, sort_order, vimeo_video_id, vimeo_hash, vimeo_thumbnail_url, vimeo_duration_seconds, description_json";

/** Drives the Resources nav item: true when at least one published course
 *  is visible to him. */
export async function hasVisibleCourses(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id")
    .eq("is_published", true)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export async function listLibraryCourses(userId: string): Promise<LibraryCourse[]> {
  const supabase = await createSupabaseServerClient();
  const { data: courseData } = await supabase
    .from("courses")
    .select(COURSE_COLUMNS)
    .eq("is_published", true);
  const courses = sortCourses((courseData ?? []) as CourseRow[]);
  if (courses.length === 0) return [];

  const ids = courses.map((c) => c.id);
  const [{ data: lessonData }, { data: sectionData }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, course_id, section_id, sort_order, vimeo_thumbnail_url")
      .in("course_id", ids)
      .order("sort_order", { ascending: true }),
    supabase.from("course_sections").select("id, sort_order").in("course_id", ids),
  ]);
  // Section ids are unique across courses, so one ordering pass covers
  // every course; the per-course filter below keeps that order.
  const lessons = orderLessons(
    (lessonData ?? []) as Array<{
      id: string;
      course_id: string;
      section_id: string | null;
      sort_order: number;
      vimeo_thumbnail_url: string | null;
    }>,
    (sectionData ?? []) as { id: string; sort_order: number }[],
  );

  const lessonIds = lessons.map((l) => l.id);
  const { data: completionData } = lessonIds.length
    ? await supabase
        .from("lesson_completions")
        .select("lesson_id")
        .eq("user_id", userId)
        .in("lesson_id", lessonIds)
    : { data: [] };
  const done = new Set(((completionData ?? []) as { lesson_id: string }[]).map((r) => r.lesson_id));

  return courses.map((c) => {
    const own = lessons.filter((l) => l.course_id === c.id);
    return {
      ...c,
      lessonCount: own.length,
      // Cover is the first lesson's thumbnail, per the spec. A PDF-only
      // first lesson means no cover; the card falls back to the mark.
      coverThumbnail: own[0]?.vimeo_thumbnail_url ?? null,
      completedCount: own.filter((l) => done.has(l.id)).length,
    };
  });
}

export type CoursePageData = {
  course: CourseRow;
  /** Empty for a course that doesn't use sections. */
  sections: SectionRow[];
  /** In course order (section by section when sectioned). */
  lessons: LessonRow[];
  completed: Set<string>;
};

export async function loadCourseBySlug(
  slug: string,
  userId: string,
  opts: { preview: boolean },
): Promise<CoursePageData | null> {
  const supabase = await createSupabaseServerClient();
  let q = supabase.from("courses").select(COURSE_COLUMNS).eq("slug", slug);
  if (!opts.preview) q = q.eq("is_published", true);
  const { data: course } = await q.maybeSingle();
  if (!course) return null;

  const c = course as CourseRow;
  const [{ data: lessonData }, { data: sectionData }] = await Promise.all([
    supabase
      .from("lessons")
      .select(LESSON_COLUMNS)
      .eq("course_id", c.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    c.uses_sections
      ? supabase
          .from("course_sections")
          .select("id, course_id, title, sort_order")
          .eq("course_id", c.id)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const sections = (sectionData ?? []) as SectionRow[];
  const lessons = orderLessons((lessonData ?? []) as LessonRow[], sections);

  const { data: completionData } = lessons.length
    ? await supabase
        .from("lesson_completions")
        .select("lesson_id")
        .eq("user_id", userId)
        .in(
          "lesson_id",
          lessons.map((l) => l.id),
        )
    : { data: [] };
  const completed = new Set(((completionData ?? []) as { lesson_id: string }[]).map((r) => r.lesson_id));

  return { course: c, sections, lessons, completed };
}

export async function loadLessonFiles(lessonId: string): Promise<LessonFileRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("lesson_files")
    .select("id, lesson_id, file_name, size_bytes, sort_order")
    .eq("lesson_id", lessonId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as LessonFileRow[];
}
