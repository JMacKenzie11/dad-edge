import Link from "next/link";
import Image from "next/image";
import { requireAccess } from "@/lib/session";
import { listLibraryCourses } from "@/lib/resources/queries";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const { user } = await requireAccess();
  const courses = await listLibraryCourses(user.id);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl">Resources</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Courses from Larry and the Dad Edge team. Work through them at your own pace.
        </p>
      </header>

      {courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          body="Courses will show up here when your community has some. Check back soon."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const percent = c.lessonCount === 0 ? 0 : Math.round((c.completedCount / c.lessonCount) * 100);
            const started = c.completedCount > 0;
            return (
              <li key={c.id}>
                <Link
                  href={`/resources/${c.slug}`}
                  className="group block h-full overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-primary)] transition-colors"
                >
                  <div className="relative aspect-video bg-[color:var(--color-surface-2)]">
                    {c.coverThumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.coverThumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Image src="/brand/mark-white.png" alt="" width={56} height={56} className="opacity-60" />
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-3">
                    <h2 className="font-heading text-base leading-snug group-hover:text-[color:var(--color-accent)]">{c.title}</h2>
                    <p className="text-xs text-[color:var(--color-text-muted)]">
                      {c.lessonCount} {c.lessonCount === 1 ? "lesson" : "lessons"}
                      {started ? ` · ${c.completedCount} done` : ""}
                    </p>
                    {started ? (
                      <div
                        className="h-1.5 rounded-full bg-[color:var(--color-surface-2)] overflow-hidden"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        aria-label={`${percent}% complete`}
                      >
                        <div className="h-full bg-[color:var(--color-primary)]" style={{ width: `${percent}%` }} />
                      </div>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
