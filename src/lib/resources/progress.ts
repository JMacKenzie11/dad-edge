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

export type SectionRef = { id: string; sort_order: number };
export type OrderedLessonRef = { section_id: string | null; sort_order: number };

/**
 * Course order for a sectioned course: sections in their order, lessons in
 * theirs inside each. A lesson with no section (only possible mid-edit)
 * goes last rather than disappearing. With no sections this is a plain
 * sort_order sort, so flat courses come out as they always did.
 */
export function orderLessons<T extends OrderedLessonRef>(lessons: T[], sections: SectionRef[]): T[] {
  const rank = new Map(sections.map((s) => [s.id, s.sort_order]));
  const sectionRank = (l: T) => (l.section_id != null && rank.has(l.section_id) ? rank.get(l.section_id)! : Infinity);
  return lessons
    .map((l, i) => ({ l, i }))
    .sort((a, b) => sectionRank(a.l) - sectionRank(b.l) || a.l.sort_order - b.l.sort_order || a.i - b.i)
    .map(({ l }) => l);
}

/**
 * Lessons grouped under their sections, sections in order. Empty sections
 * are kept (the admin editor shows them; the member page skips them).
 * Lessons whose section isn't in the list land in a trailing group with
 * section null.
 */
export function groupLessonsBySection<S extends SectionRef, T extends OrderedLessonRef>(
  sections: S[],
  lessons: T[],
): Array<{ section: S | null; lessons: T[] }> {
  const ordered = orderLessons(lessons, sections);
  const groups = [...sections]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((section) => ({ section: section as S | null, lessons: ordered.filter((l) => l.section_id === section.id) }));
  const known = new Set(sections.map((s) => s.id));
  const loose = ordered.filter((l) => l.section_id == null || !known.has(l.section_id));
  if (loose.length > 0) groups.push({ section: null, lessons: loose });
  return groups;
}
