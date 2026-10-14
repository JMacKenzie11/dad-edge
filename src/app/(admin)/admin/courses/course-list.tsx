"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SortableList } from "@/components/ui/sortable-list";
import { useConfirm } from "@/components/ui/use-confirm";
import { deleteCourse, reorderCourses, setCourseFlag } from "./actions";

export type AdminCourseRow = {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  isPinned: boolean;
  lessonCount: number;
  fileCount: number;
  restrictedTo: number;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function CourseList({ courses }: { courses: AdminCourseRow[] }) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (courses.length === 0) {
    return (
      <p className="px-4 py-8 text-sm text-center text-[color:var(--color-text-muted)] border border-dashed border-[color:var(--color-border)] rounded-[var(--radius-card)]">
        No courses yet. Create one above to start adding lessons.
      </p>
    );
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "That didn't save. Try again.");
      router.refresh();
    });
  }

  async function onDelete(c: AdminCourseRow) {
    const goesWithIt =
      c.lessonCount === 0
        ? "It has no lessons yet."
        : `Its ${plural(c.lessonCount, "lesson", "lessons")} and ${plural(c.fileCount, "file", "files")} go with it, along with every member's progress on it.`;
    const ok = await confirm({
      title: `Delete ${c.title}?`,
      body: `${goesWithIt} This can't be undone.`,
      confirmLabel: "Delete course",
      destructive: true,
    });
    if (ok) run(() => deleteCourse(c.id));
  }

  return (
    <div className="space-y-2">
      {dialog}
      <SortableList
        items={courses}
        itemLabel={(c) => c.title}
        onReorder={async (ids) => {
          const res = await reorderCourses(ids);
          return res.ok ? { ok: true } : { ok: false, error: res.error };
        }}
        renderItem={(c) => (
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 py-3 pr-2">
            <div className="flex-1 min-w-0">
              <Link href={`/admin/courses/${c.id}`} className="font-heading text-sm hover:text-[color:var(--color-accent)]">
                {c.title}
              </Link>
              <p className="text-xs text-[color:var(--color-text-muted)]">
                {plural(c.lessonCount, "lesson", "lessons")} · {plural(c.fileCount, "file", "files")} ·{" "}
                {c.restrictedTo === 0 ? "All communities" : plural(c.restrictedTo, "community", "communities")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="font-heading text-[10px] tracking-widest px-2 py-1 rounded-full border"
                style={{
                  color: c.isPublished ? "var(--color-accent)" : "var(--color-text-muted)",
                  borderColor: c.isPublished ? "var(--color-accent)" : "var(--color-border)",
                }}
              >
                {c.isPublished ? "PUBLISHED" : "DRAFT"}
              </span>
              {c.isPinned ? (
                <span className="font-heading text-[10px] tracking-widest px-2 py-1 rounded-full border border-[color:var(--color-warning)] text-[color:var(--color-warning)]">
                  PINNED
                </span>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setCourseFlag(c.id, "is_published", !c.isPublished))}
                className="h-8 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-surface-2)]"
              >
                {c.isPublished ? "UNPUBLISH" : "PUBLISH"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setCourseFlag(c.id, "is_pinned", !c.isPinned))}
                className="h-8 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-surface-2)]"
              >
                {c.isPinned ? "UNPIN" : "PIN"}
              </button>
              <Link
                href={`/admin/courses/${c.id}`}
                className="h-8 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-surface-2)] inline-flex items-center"
              >
                EDIT
              </Link>
              <button
                type="button"
                disabled={pending}
                onClick={() => onDelete(c)}
                className="h-8 px-3 rounded-md border border-[color:var(--color-danger)] text-[color:var(--color-danger)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-danger)] hover:text-white"
              >
                DELETE
              </button>
            </div>
          </div>
        )}
      />
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
