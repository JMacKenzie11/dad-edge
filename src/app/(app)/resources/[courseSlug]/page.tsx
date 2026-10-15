import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { loadCourseBySlug } from "@/lib/resources/queries";
import { courseProgress, groupLessonsBySection } from "@/lib/resources/progress";
import type { LessonRow } from "@/lib/resources/queries";
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
  const { course, sections, lessons, completed } = data;
  const progress = courseProgress(lessons, completed);
  const overview = readStoredDoc(course.overview_json);
  const lessonCountLabel = countLabel(lessons.length, "lesson");
  // Members never see an empty section. A lesson outside every section
  // (only possible mid-edit) still shows, in an untitled group at the end.
  const groups = course.uses_sections
    ? groupLessonsBySection(sections, lessons).filter((g) => g.lessons.length > 0)
    : [];
  const overviewMeta =
    groups.length > 0 ? `${countLabel(groups.length, "section")} · ${lessonCountLabel}` : lessonCountLabel;

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

      {/* No Next up card here: from the course page the next step is the
          first lesson. Next up lives at the end of each lesson instead. */}
      <div className="space-y-4">
        <section className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-base">Overview</h2>
            <span className="text-xs text-[color:var(--color-text-muted)]">{overviewMeta}</span>
          </div>
          {overview ? (
            <CollapsibleText long={plainText(overview).length > 600}>
              <RichTextView value={overview} />
            </CollapsibleText>
          ) : (
            <p className="text-sm text-[color:var(--color-text-muted)]">Work through the lessons in order.</p>
          )}
        </section>

        <div className="space-y-4">
          {groups.length > 0 ? (
            groups.map((g) => (
              <CollapsibleCard
                key={g.section?.id ?? "more"}
                title={g.section?.title ?? "More lessons"}
                meta={countLabel(g.lessons.length, "lesson")}
              >
                <LessonRows lessons={g.lessons} completed={completed} hrefFor={(id) => `/resources/${course.slug}/${id}${q}`} />
              </CollapsibleCard>
            ))
          ) : (
            <CollapsibleCard title="Course Content" meta={lessonCountLabel}>
              {lessons.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[color:var(--color-text-muted)]">No lessons yet.</p>
              ) : (
                <LessonRows lessons={lessons} completed={completed} hrefFor={(id) => `/resources/${course.slug}/${id}${q}`} />
              )}
            </CollapsibleCard>
          )}
        </div>
      </div>
    </div>
  );
}

function countLabel(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

function LessonRows({
  lessons,
  completed,
  hrefFor,
}: {
  lessons: LessonRow[];
  completed: ReadonlySet<string>;
  hrefFor: (lessonId: string) => string;
}) {
  return (
    <ol className="divide-y divide-[color:var(--color-border)]">
      {lessons.map((l) => (
        <li key={l.id}>
          <Link href={hrefFor(l.id)} className="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--color-surface-2)]">
            <LessonThumb src={l.vimeo_thumbnail_url} className="w-24 sm:w-28" label="PDF" />
            <CompletionIndicator complete={completed.has(l.id)} />
            <span className="flex-1 min-w-0 text-sm leading-snug">{l.title}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
