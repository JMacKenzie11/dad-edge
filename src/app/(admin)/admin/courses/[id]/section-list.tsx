"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { useConfirm } from "@/components/ui/use-confirm";
import { createLesson, deleteSection, renameSection, reorderSections, setCourseSections } from "../actions";
import { LessonList, type AdminLessonRow } from "./lesson-list";

export type AdminSection = { id: string; title: string; lessons: AdminLessonRow[] };

/**
 * Lessons editor for a course that uses sections. Each section is a card
 * with its title (RENAME), up and down arrows to move the whole section,
 * DELETE (empty sections only), its lessons, and an ADD LESSON form that
 * adds to that section. Lessons reorder inside their section here; moving
 * a lesson to another section is on the lesson's own edit page.
 *
 * Sections move by arrow buttons rather than drag so the lesson lists
 * inside them keep their own drag handles without the two fighting.
 */
export function SectionList({ courseId, sections }: { courseId: string; sections: AdminSection[] }) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ sectionId: string; message: string } | null>(null);

  function run(sectionId: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError({ sectionId, message: res.error });
      router.refresh();
    });
  }

  function move(index: number, to: number) {
    if (to < 0 || to >= sections.length) return;
    const ids = sections.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved);
    run(moved, () => reorderSections(courseId, ids));
  }

  async function onDelete(s: AdminSection) {
    if (s.lessons.length > 0) {
      setError({ sectionId: s.id, message: "Move or delete this section's lessons first. Only an empty section can be deleted." });
      return;
    }
    const ok = await confirm({
      title: `Delete ${s.title}?`,
      body: "The section has no lessons, so nothing else changes.",
      confirmLabel: "Delete section",
      destructive: true,
    });
    if (ok) run(s.id, () => deleteSection(s.id));
  }

  if (sections.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-center text-[color:var(--color-text-muted)] border border-dashed border-[color:var(--color-border)] rounded-[var(--radius-card)]">
        No sections yet. Add the first one below, then add lessons to it.
      </p>
    );
  }

  let lessonsBefore = 0;
  return (
    <div className="space-y-4">
      {dialog}
      {sections.map((s, i) => {
        const startIndex = lessonsBefore;
        lessonsBefore += s.lessons.length;
        return (
          <section
            key={s.id}
            className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle
                title={s.title}
                disabled={pending}
                onSave={(title) => run(s.id, () => renameSection(s.id, title))}
              />
              <span className="text-xs text-[color:var(--color-text-muted)]">
                {s.lessons.length} {s.lessons.length === 1 ? "lesson" : "lessons"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={pending || i === 0}
                  onClick={() => move(i, i - 1)}
                  aria-label={`Move ${s.title} up`}
                  className="h-8 w-8 rounded-md border border-[color:var(--color-border)] text-xs disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={pending || i === sections.length - 1}
                  onClick={() => move(i, i + 1)}
                  aria-label={`Move ${s.title} down`}
                  className="h-8 w-8 rounded-md border border-[color:var(--color-border)] text-xs disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onDelete(s)}
                  aria-label={`Delete section ${s.title}`}
                  className="h-8 px-3 rounded-md border border-[color:var(--color-danger)] text-[color:var(--color-danger)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-danger)] hover:text-white"
                >
                  DELETE
                </button>
              </div>
            </div>
            {error?.sectionId === s.id ? <p className="text-xs text-[color:var(--color-danger)]">{error.message}</p> : null}

            <LessonList
              courseId={courseId}
              lessons={s.lessons}
              sectionId={s.id}
              startIndex={startIndex}
              emptyText="No lessons in this section yet."
            />
            <form action={createLesson} className="flex flex-col sm:flex-row gap-2">
              <input type="hidden" name="course_id" value={courseId} />
              <input type="hidden" name="section_id" value={s.id} />
              <input
                name="title"
                required
                minLength={2}
                maxLength={160}
                placeholder={`New lesson in ${s.title}`}
                aria-label={`New lesson title for ${s.title}`}
                className="flex-1 h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
              />
              <SubmitButton label="ADD LESSON" pendingLabel="ADDING…" />
            </form>
          </section>
        );
      })}
    </div>
  );
}

function SectionTitle({ title, disabled, onSave }: { title: string; disabled: boolean; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!editing) {
    return (
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <h3 className="font-heading text-base truncate">{title}</h3>
        <button
          type="button"
          onClick={() => {
            setValue(title);
            setEditing(true);
          }}
          className="text-[11px] font-heading tracking-widest text-[color:var(--color-accent)] hover:underline"
        >
          RENAME
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex-1 min-w-0 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setEditing(false);
        if (value.trim() !== title) onSave(value);
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        maxLength={120}
        autoFocus
        aria-label="Section title"
        className="flex-1 min-w-0 h-9 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
      />
      <button
        type="submit"
        disabled={disabled}
        className="h-9 px-3 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-[11px] tracking-widest"
      >
        SAVE
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="h-9 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-[11px] tracking-widest"
      >
        CANCEL
      </button>
    </form>
  );
}

/** ORGANIZE INTO SECTIONS / REMOVE SECTIONS, with the consequences spelled
 *  out before anything changes. */
export function SectionsToggle({
  courseId,
  usesSections,
  lessonCount,
  sectionCount,
}: {
  courseId: string;
  usesSections: boolean;
  lessonCount: number;
  sectionCount: number;
}) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    const ok = await confirm(
      usesSections
        ? {
            title: "Remove sections?",
            body:
              sectionCount === 0
                ? "The course goes back to one list of lessons."
                : `The ${sectionCount === 1 ? "section title is" : `${sectionCount} section titles are`} deleted. Every lesson stays, in the same order, as one list.`,
            confirmLabel: "Remove sections",
            destructive: true,
          }
        : {
            title: "Organize into sections?",
            body:
              lessonCount === 0
                ? "Add sections, then add lessons inside each one."
                : `Your ${lessonCount === 1 ? "lesson goes" : `${lessonCount} lessons go`} into one section called Lessons. Rename it, add more sections, and move lessons between them from each lesson's edit page.`,
            confirmLabel: "Organize into sections",
          },
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await setCourseSections(courseId, !usesSections);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <>
      {dialog}
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        className="h-8 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-surface-2)]"
      >
        {usesSections ? "REMOVE SECTIONS" : "ORGANIZE INTO SECTIONS"}
      </button>
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </>
  );
}
