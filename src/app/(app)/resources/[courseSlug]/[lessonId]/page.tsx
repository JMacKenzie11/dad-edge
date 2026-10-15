import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { loadCourseBySlug, loadLessonFiles } from "@/lib/resources/queries";
import { adjacentLessons } from "@/lib/resources/progress";
import { vimeoEmbedUrl } from "@/lib/resources/vimeo";
import { formatFileSize } from "@/lib/resources/files";
import { readStoredDoc } from "@/lib/rich-text/doc";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { SubmitButton } from "@/components/ui/submit-button";
import { CompletionIndicator, PreviewBanner } from "../../resource-ui";
import { markLessonComplete, markLessonIncomplete } from "../../actions";
import { LessonPlayer } from "./lesson-player";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseSlug: string; lessonId: string }>;
  searchParams: Promise<{ preview?: string; error?: string }>;
}) {
  const { user, readOnly } = await requireAccess();
  const { courseSlug, lessonId } = await params;
  const sp = await searchParams;
  if (!UUID.test(lessonId)) notFound();
  const preview = sp.preview === "1" && user.is_platform_admin;
  const q = preview ? "?preview=1" : "";

  const data = await loadCourseBySlug(courseSlug, user.id, { preview });
  if (!data) notFound();
  const { course, sections, lessons, completed } = data;
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) notFound();
  const files = await loadLessonFiles(lesson.id);
  const { prev, next, index } = adjacentLessons(lessons, lesson.id);
  const isComplete = completed.has(lesson.id);
  const description = readStoredDoc(lesson.description_json);
  const fileQuery = preview ? "?preview=1" : "";
  const sectionTitle = sections.find((s) => s.id === lesson.section_id)?.title ?? null;

  return (
    <div className="space-y-5">
      {preview ? <PreviewBanner isPublished={course.is_published} /> : null}
      <Link
        href={`/resources/${course.slug}${q}`}
        className="inline-block text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
      >
        ← {course.title.toUpperCase()}
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {sectionTitle ? `${sectionTitle.toUpperCase()} · ` : ""}LESSON {index + 1} OF {lessons.length}
        </p>
        <h1 className="font-heading text-2xl leading-tight">{lesson.title}</h1>
      </header>

      {lesson.vimeo_video_id ? (
        <LessonPlayer
          embedUrl={vimeoEmbedUrl(lesson.vimeo_video_id, lesson.vimeo_hash)}
          thumbnailUrl={lesson.vimeo_thumbnail_url}
          title={lesson.title}
        />
      ) : null}

      {description ? (
        <section className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
          <RichTextView value={description} />
        </section>
      ) : null}

      {files.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-heading text-xs tracking-widest text-[color:var(--color-text-muted)]">
            {files.length === 1 ? "DOWNLOAD" : "DOWNLOADS"}
          </h2>
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id}>
                <a
                  href={`/api/resources/files/${f.id}${fileQuery}`}
                  className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 hover:border-[color:var(--color-primary)]"
                >
                  <DocumentIcon />
                  <span className="flex-1 min-w-0 text-sm truncate">{f.file_name}</span>
                  <span className="text-xs text-[color:var(--color-text-muted)] whitespace-nowrap">
                    PDF · {formatFileSize(f.size_bytes)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!lesson.vimeo_video_id && !description && files.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">Nothing&apos;s been added to this lesson yet.</p>
      ) : null}

      <section
        className={
          "rounded-[var(--radius-card)] border p-5 " +
          (isComplete
            ? "border-[color:var(--color-primary)] bg-[color:var(--color-surface)]"
            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)]")
        }
      >
        {sp.error ? <p className="mb-3 text-xs text-[color:var(--color-danger)]">{sp.error}</p> : null}
        {isComplete ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <CompletionIndicator complete />
              <p className="text-sm">You marked this lesson complete.</p>
            </div>
            {!readOnly ? (
              <form action={markLessonIncomplete}>
                <input type="hidden" name="lesson_id" value={lesson.id} />
                {preview ? <input type="hidden" name="preview" value="1" /> : null}
                <button
                  type="submit"
                  className="text-xs text-[color:var(--color-text-muted)] underline underline-offset-2 hover:text-[color:var(--color-text)]"
                >
                  Mark as not complete
                </button>
              </form>
            ) : null}
          </div>
        ) : readOnly ? (
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Your account is read-only right now, so lesson progress can&apos;t be saved.
          </p>
        ) : (
          <form action={markLessonComplete} className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input type="hidden" name="lesson_id" value={lesson.id} />
            {preview ? <input type="hidden" name="preview" value="1" /> : null}
            <p className="flex-1 font-heading text-base">Ready to move on to the next lesson?</p>
            <SubmitButton label="MARK AS COMPLETE" pendingLabel="SAVING…" />
          </form>
        )}
      </section>

      <nav className="flex items-stretch justify-between gap-3" aria-label="Lesson navigation">
        {prev ? (
          <Link
            href={`/resources/${course.slug}/${prev.id}${q}`}
            className="flex-1 max-w-[48%] rounded-[var(--radius-card)] border border-[color:var(--color-border)] px-4 py-3 hover:bg-[color:var(--color-surface)]"
          >
            <span className="block text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">← PREVIOUS</span>
            <span className="block text-sm truncate">{prev.title}</span>
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        {next ? (
          <Link
            href={`/resources/${course.slug}/${next.id}${q}`}
            className="flex-1 max-w-[48%] rounded-[var(--radius-card)] border border-[color:var(--color-border)] px-4 py-3 text-right hover:bg-[color:var(--color-surface)]"
          >
            <span className="block text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">NEXT →</span>
            <span className="block text-sm truncate">{next.title}</span>
          </Link>
        ) : (
          <span className="flex-1" />
        )}
      </nav>
    </div>
  );
}

function DocumentIcon() {
  return (
    <svg width="22" height="26" viewBox="0 0 20 24" fill="none" aria-hidden className="shrink-0 text-[color:var(--color-accent)]">
      <path d="M2 1h11l5 5v17H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 1v5h5M5.5 13h9M5.5 16.5h9M5.5 9.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
