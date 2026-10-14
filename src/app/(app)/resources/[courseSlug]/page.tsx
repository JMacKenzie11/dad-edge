import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { loadCourseBySlug } from "@/lib/resources/queries";
import { courseProgress, nextUpLesson } from "@/lib/resources/progress";
import { plainText, readStoredDoc } from "@/lib/rich-text/doc";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { CompletionIndicator, CourseMark, LessonThumb, PreviewBanner } from "../resource-ui";
import { CollapsibleCard, CollapsibleText } from "./collapsibles";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseSlug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { user } = await requireAccess();
  const { courseSlug } = await params;
  const sp = await searchParams;
  const preview = sp.preview === "1" && user.is_platform_admin;
  const q = preview ? "?preview=1" : "";

  const data = await loadCourseBySlug(courseSlug, user.id, { preview });
  if (!data) notFound();
  const { course, lessons, completed } = data;
  const progress = courseProgress(lessons, completed);
  const next = nextUpLesson(lessons, completed);
  const overview = readStoredDoc(course.overview_json);
  const lessonCountLabel = `${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"}`;

  return (
    <div className="space-y-5">
      {preview ? <PreviewBanner isPublished={course.is_published} /> : null}
      <Link
        href={`/resources${q}`}
        className="inline-block text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
      >
        ← RESOURCES
      </Link>

      <header className="flex items-center gap-4">
        <CourseMark size={56} />
        <div className="min-w-0">
          <h1 className="font-heading text-2xl leading-tight">{course.title}</h1>
          {progress.started ? (
            <p className="text-xs text-[color:var(--color-text-muted)]">
              {progress.completed} of {progress.total} lessons done
            </p>
          ) : null}
        </div>
      </header>

      {/* DOM order is Overview, Next up, Course Content, so on a phone Next
          up sits above the lesson list. On desktop the grid pins Next up in
          the right column across both rows. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <section className="lg:col-start-1 lg:row-start-1 rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-base">Overview</h2>
            <span className="text-xs text-[color:var(--color-text-muted)]">{lessonCountLabel}</span>
          </div>
          {overview ? (
            <CollapsibleText long={plainText(overview).length > 600}>
              <RichTextView value={overview} />
            </CollapsibleText>
          ) : (
            <p className="text-sm text-[color:var(--color-text-muted)]">Work through the lessons in order.</p>
          )}
        </section>

        <aside className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-28">
          <div className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 space-y-3">
            <h2 className="font-heading text-xs tracking-widest text-[color:var(--color-text-muted)]">
              {next ? "NEXT UP" : "COURSE COMPLETE"}
            </h2>
            {next ? (
              <Link href={`/resources/${course.slug}/${next.id}${q}`} className="group block space-y-3">
                <LessonThumb src={next.vimeo_thumbnail_url} className="w-full" label="PDF LESSON" />
                <div className="flex items-center gap-3">
                  <p className="flex-1 text-sm leading-snug group-hover:text-[color:var(--color-accent)]">{next.title}</p>
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)] text-white"
                    aria-hidden
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="sr-only">Open {next.title}</span>
                </div>
              </Link>
            ) : lessons.length === 0 ? (
              <p className="text-sm text-[color:var(--color-text-muted)]">Lessons will show up here soon.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">You finished every lesson in this course.</p>
                <Link
                  href={`/resources${q}`}
                  className="inline-flex h-10 items-center px-4 rounded-md border border-[color:var(--color-border)] font-heading text-xs tracking-widest hover:bg-[color:var(--color-surface-2)]"
                >
                  BACK TO RESOURCES
                </Link>
              </div>
            )}
          </div>
        </aside>

        <div className="lg:col-start-1 lg:row-start-2">
          <CollapsibleCard title="Course Content" meta={lessonCountLabel}>
            {lessons.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[color:var(--color-text-muted)]">No lessons yet.</p>
            ) : (
              <ol className="divide-y divide-[color:var(--color-border)]">
                {lessons.map((l) => {
                  const done = completed.has(l.id);
                  return (
                    <li key={l.id}>
                      <Link
                        href={`/resources/${course.slug}/${l.id}${q}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--color-surface-2)]"
                      >
                        <LessonThumb src={l.vimeo_thumbnail_url} className="w-24 sm:w-28" label="PDF" />
                        <CompletionIndicator complete={done} />
                        <span className="flex-1 min-w-0 text-sm leading-snug">{l.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
}
