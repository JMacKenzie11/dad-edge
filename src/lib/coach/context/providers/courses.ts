import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * Courses provider: the Resource Library courses he has started or
 * finished, titles and progress only. No lesson content, no descriptions;
 * the coach needs to know "he's halfway through the Patience Course", not
 * what's in it.
 *
 * Runs on the service client like every other provider, so it re-applies
 * the member visibility rule itself: published, and either open to every
 * community or restricted to one he's in. A course that was unpublished
 * or restricted away from him after he started it drops out.
 *
 * Returns null when he hasn't marked a single lesson complete.
 */
export const coursesProvider: ContextProvider = {
  key: "courses",
  priority: 40,
  cacheable: false,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const { data: completionData } = await svc
      .from("lesson_completions")
      .select("lesson_id, completed_at, lessons:lesson_id(course_id)")
      .eq("user_id", user.id);
    const completions = (completionData ?? []) as unknown as Array<{
      lesson_id: string;
      completed_at: string;
      lessons: { course_id: string } | { course_id: string }[] | null;
    }>;
    if (completions.length === 0) return null;

    const lastByCourse = new Map<string, string>();
    const doneLessons = new Set<string>();
    for (const c of completions) {
      const rel = Array.isArray(c.lessons) ? c.lessons[0] : c.lessons;
      if (!rel) continue;
      doneLessons.add(c.lesson_id);
      const prev = lastByCourse.get(rel.course_id);
      if (!prev || c.completed_at > prev) lastByCourse.set(rel.course_id, c.completed_at);
    }
    const courseIds = [...lastByCourse.keys()];
    if (courseIds.length === 0) return null;

    const [{ data: courseData }, { data: lessonData }, { data: visData }, { data: memberData }] = await Promise.all([
      svc.from("courses").select("id, title, is_published").in("id", courseIds),
      svc.from("lessons").select("id, course_id").in("course_id", courseIds),
      svc.from("course_communities").select("course_id, community_id").in("course_id", courseIds),
      svc.from("memberships").select("community_id, status, canceled_visible_until").eq("user_id", user.id),
    ]);

    const myCommunities = new Set(
      ((memberData ?? []) as { community_id: string; status: string; canceled_visible_until: string | null }[])
        .filter((m) => m.status === "active" || (m.canceled_visible_until && new Date(m.canceled_visible_until) > new Date()))
        .map((m) => m.community_id),
    );
    const restrictions = new Map<string, string[]>();
    for (const v of (visData ?? []) as { course_id: string; community_id: string }[]) {
      restrictions.set(v.course_id, [...(restrictions.get(v.course_id) ?? []), v.community_id]);
    }
    const lessons = (lessonData ?? []) as { id: string; course_id: string }[];

    const rows = ((courseData ?? []) as { id: string; title: string; is_published: boolean }[])
      .filter((c) => c.is_published)
      .filter((c) => {
        const only = restrictions.get(c.id);
        return !only || only.some((id) => myCommunities.has(id));
      })
      .map((c) => {
        const own = lessons.filter((l) => l.course_id === c.id);
        const done = own.filter((l) => doneLessons.has(l.id)).length;
        return { title: c.title, done, total: own.length, last: lastByCourse.get(c.id) ?? "" };
      })
      .filter((r) => r.total > 0 && r.done > 0)
      .sort((a, b) => b.last.localeCompare(a.last));

    if (rows.length === 0) return null;

    const inProgress = rows.filter((r) => r.done < r.total);
    const finished = rows.filter((r) => r.done >= r.total);
    const lines: string[] = [];
    if (inProgress.length > 0) {
      lines.push("In progress:");
      for (const r of inProgress.slice(0, 5)) lines.push(`  - ${r.title}: ${r.done} of ${r.total} lessons done`);
    }
    if (finished.length > 0) {
      lines.push("Finished:");
      for (const r of finished.slice(0, 5)) lines.push(`  - ${r.title} (${r.total} lessons)`);
    }
    const text = lines.join("\n");
    return { label: "Resource Library courses", text, tokenEstimate: estimateTokens(text) };
  },
};
