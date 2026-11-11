import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderLessons } from "@/lib/resources/progress";
import { ONBOARDING_COURSE_SLUG } from "./steps";

export { ONBOARDING_COURSE_SLUG };

/**
 * The two onboarding videos come from the Resource Library course with
 * slug ONBOARDING_COURSE_SLUG ("welcome"): its first lesson opens the wizard, its second closes it.
 * Swapping a video in /admin/courses changes onboarding with no deploy,
 * and finishing one here ticks it off in the library too (one
 * lesson_completions row).
 *
 * Reads run as him, so RLS decides: if the course is unpublished, hidden
 * from his communities, or the lesson has no video, there's nothing to
 * show and the step skips itself rather than stopping his sign-up.
 */

export type OnboardingVideo = {
  lessonId: string;
  title: string;
  videoId: string;
  hash: string | null;
  durationSeconds: number;
  done: boolean;
};

export async function loadOnboardingVideo(userId: string, position: 0 | 1): Promise<OnboardingVideo | null> {
  const supabase = await createSupabaseServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("slug", ONBOARDING_COURSE_SLUG)
    .eq("is_published", true)
    .maybeSingle();
  if (!course) return null;
  const [{ data: lessons }, { data: sections }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, title, section_id, sort_order, vimeo_video_id, vimeo_hash, vimeo_duration_seconds")
      .eq("course_id", course.id),
    supabase.from("course_sections").select("id, sort_order").eq("course_id", course.id),
  ]);
  type L = {
    id: string;
    title: string;
    section_id: string | null;
    sort_order: number;
    vimeo_video_id: string | null;
    vimeo_hash: string | null;
    vimeo_duration_seconds: number | null;
  };
  const lesson = orderLessons((lessons ?? []) as L[], (sections ?? []) as { id: string; sort_order: number }[])[position];
  if (!lesson?.vimeo_video_id) return null;
  const { data: done } = await supabase
    .from("lesson_completions")
    .select("lesson_id")
    .eq("user_id", userId)
    .eq("lesson_id", lesson.id)
    .maybeSingle();
  return {
    lessonId: lesson.id,
    title: lesson.title,
    videoId: lesson.vimeo_video_id,
    hash: lesson.vimeo_hash,
    durationSeconds: lesson.vimeo_duration_seconds ?? 0,
    done: !!done,
  };
}
