"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCourseFlag } from "../actions";

export function CourseFlags({
  courseId,
  isPublished,
  isPinned,
  lessonCount,
}: {
  courseId: string;
  isPublished: boolean;
  isPinned: boolean;
  lessonCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(flag: "is_published" | "is_pinned", value: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setCourseFlag(courseId, flag, value);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="font-heading text-[10px] tracking-widest px-2 py-1 rounded-full border"
          style={{
            color: isPublished ? "var(--color-accent)" : "var(--color-text-muted)",
            borderColor: isPublished ? "var(--color-accent)" : "var(--color-border)",
          }}
        >
          {isPublished ? "PUBLISHED" : "DRAFT"}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle("is_published", !isPublished)}
          className={
            isPublished
              ? "h-9 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-xs tracking-widest"
              : "h-9 px-3 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest"
          }
        >
          {isPublished ? "UNPUBLISH" : "PUBLISH"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle("is_pinned", !isPinned)}
          className="h-9 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-xs tracking-widest"
        >
          {isPinned ? "UNPIN" : "PIN TO TOP"}
        </button>
      </div>
      {!isPublished ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">
          Members can&apos;t see this course until you publish it.
          {lessonCount === 0 ? " Add at least one lesson first." : ""}
        </p>
      ) : null}
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
