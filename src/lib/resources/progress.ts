/**
 * Pure course-progress helpers. Lessons arrive already sorted by
 * sort_order; completion is a set of lesson ids the man has marked done.
 */

export type LessonRef = { id: string };

export function courseProgress(
  lessons: LessonRef[],
  completed: ReadonlySet<string>,
): { completed: number; total: number; percent: number; started: boolean; finished: boolean } {
  const total = lessons.length;
  const done = lessons.filter((l) => completed.has(l.id)).length;
  return {
    completed: done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    started: done > 0,
    finished: total > 0 && done === total,
  };
}

/** First lesson he hasn't marked complete, in course order. Null when
 *  every lesson is done (or the course has none). */
export function nextUpLesson<T extends LessonRef>(
  lessons: T[],
  completed: ReadonlySet<string>,
): T | null {
  return lessons.find((l) => !completed.has(l.id)) ?? null;
}

export function adjacentLessons<T extends LessonRef>(
  lessons: T[],
  lessonId: string,
): { prev: T | null; next: T | null; index: number } {
  const index = lessons.findIndex((l) => l.id === lessonId);
  if (index === -1) return { prev: null, next: null, index: -1 };
  return {
    prev: index > 0 ? lessons[index - 1] : null,
    next: index < lessons.length - 1 ? lessons[index + 1] : null,
    index,
  };
}

/** Library order: pinned first, then the admin's sort_order, then oldest. */
export function sortCourses<T extends { is_pinned: boolean; sort_order: number; created_at: string }>(
  courses: T[],
): T[] {
  return [...courses].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  });
}
