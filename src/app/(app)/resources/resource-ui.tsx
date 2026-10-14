import Image from "next/image";
import { cn } from "@/lib/cn";

/** Shared bits for the member-side resource pages. Server-safe. */

export function CourseMark({ size = 48 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-black border border-[color:var(--color-border)]"
      style={{ width: size, height: size }}
    >
      <Image src="/brand/mark-white.png" alt="The Dad Edge" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} />
    </span>
  );
}

/** Open dotted circle when incomplete, filled check when complete. */
export function CompletionIndicator({ complete, className }: { complete: boolean; className?: string }) {
  return complete ? (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)] text-white",
        className,
      )}
      role="img"
      aria-label="Complete"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2 6.5l2.5 2.5L10 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : (
    <span
      className={cn(
        "inline-block h-6 w-6 shrink-0 rounded-full border-2 border-dotted border-[color:var(--color-text-muted)]",
        className,
      )}
      role="img"
      aria-label="Not complete"
    />
  );
}

export function LessonThumb({
  src,
  className,
  label,
}: {
  src: string | null;
  className?: string;
  /** Shown when there's no video thumbnail (a PDF-only lesson). */
  label?: string;
}) {
  return (
    <div className={cn("aspect-video shrink-0 overflow-hidden rounded-md bg-[color:var(--color-surface-2)]", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="font-heading text-[10px] tracking-widest text-[color:var(--color-text-muted)]">{label ?? "LESSON"}</span>
        </div>
      )}
    </div>
  );
}

export function PreviewBanner({ isPublished }: { isPublished: boolean }) {
  return (
    <p className="rounded-md border border-[color:var(--color-warning)] px-3 py-2 text-xs text-[color:var(--color-warning)]">
      {isPublished
        ? "Admin preview. This is what members see."
        : "Admin preview. This course is a draft, so members can't see it yet."}
    </p>
  );
}
