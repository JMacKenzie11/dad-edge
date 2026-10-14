"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SortableList } from "@/components/ui/sortable-list";
import { useConfirm } from "@/components/ui/use-confirm";
import { formatDuration } from "@/lib/resources/vimeo";
import { deleteLesson, reorderLessons } from "../actions";

export type AdminLessonRow = {
  id: string;
  title: string;
  hasVideo: boolean;
  thumbnail: string | null;
  durationSeconds: number | null;
  fileCount: number;
};

export function LessonList({ courseId, lessons }: { courseId: string; lessons: AdminLessonRow[] }) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (lessons.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-center text-[color:var(--color-text-muted)] border border-dashed border-[color:var(--color-border)] rounded-[var(--radius-card)]">
        No lessons yet. Add the first one below.
      </p>
    );
  }

  async function onDelete(l: AdminLessonRow) {
    const files =
      l.fileCount === 0 ? "" : l.fileCount === 1 ? "Its file goes with it. " : `Its ${l.fileCount} files go with it. `;
    const ok = await confirm({
      title: `Delete ${l.title}?`,
      body: `${files}Members lose their progress on this lesson. This can't be undone.`,
      confirmLabel: "Delete lesson",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteLesson(l.id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {dialog}
      <SortableList
        items={lessons}
        itemLabel={(l) => l.title}
        onReorder={async (ids) => {
          const res = await reorderLessons(courseId, ids);
          if (res.ok) router.refresh();
          return res.ok ? { ok: true } : { ok: false, error: res.error };
        }}
        renderItem={(l, i) => (
          <div className="flex items-center gap-3 py-2 pr-2">
            <span className="w-6 text-right text-xs text-[color:var(--color-text-muted)]">{i + 1}</span>
            <div className="w-20 h-11 shrink-0 rounded overflow-hidden bg-[color:var(--color-surface-2)] flex items-center justify-center">
              {l.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
                  {l.fileCount > 0 ? "PDF" : "EMPTY"}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Link
                href={`/admin/courses/${courseId}/lessons/${l.id}`}
                className="text-sm hover:text-[color:var(--color-accent)] line-clamp-2"
              >
                {l.title}
              </Link>
              <p className="text-xs text-[color:var(--color-text-muted)]">
                {l.hasVideo ? `Video${formatDuration(l.durationSeconds) ? ` · ${formatDuration(l.durationSeconds)}` : ""}` : "No video"}
                {" · "}
                {l.fileCount === 0 ? "No files" : `${l.fileCount} ${l.fileCount === 1 ? "PDF" : "PDFs"}`}
              </p>
            </div>
            <Link
              href={`/admin/courses/${courseId}/lessons/${l.id}`}
              className="hidden sm:inline-flex h-8 px-3 items-center rounded-md border border-[color:var(--color-border)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-surface-2)]"
            >
              EDIT
            </Link>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDelete(l)}
              aria-label={`Delete ${l.title}`}
              className="h-8 px-3 rounded-md border border-[color:var(--color-danger)] text-[color:var(--color-danger)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-danger)] hover:text-white"
            >
              DELETE
            </button>
          </div>
        )}
      />
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
