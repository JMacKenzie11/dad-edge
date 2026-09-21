import Link from "next/link";
import { format } from "date-fns";

/**
 * Prev / next arrows over the mission week, the same shape as the
 * day arrows on /today. One week on screen at a time.
 *
 * Bounds are decided by the page and handed here as hrefs:
 *   - back stops at last week, and only while the community grace
 *     period is still open
 *   - forward stops at next week, and only on a Sunday (front-load
 *     the week before it starts)
 *
 * Server component — anchors and a query param do all the work.
 */
export function WeekNavigator({
  monday,
  sunday,
  prevHref,
  nextHref,
  note,
}: {
  monday: string;
  sunday: string;
  prevHref: string | null;
  nextHref: string | null;
  /** Short line under the dates — which week this is, and for last
   *  week, how long it stays open. Null on the current week. */
  note: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <NavArrow href={prevHref} direction="prev" label="Previous week" />
      <div className="text-center min-w-0">
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          WEEK OF {format(new Date(`${monday}T00:00:00`), "MMM d").toUpperCase()}
          {" – "}
          {format(new Date(`${sunday}T00:00:00`), "MMM d").toUpperCase()}
        </p>
        {note ? (
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-accent)] mt-0.5">
            {note}
          </p>
        ) : null}
      </div>
      <NavArrow href={nextHref} direction="next" label="Next week" />
    </div>
  );
}

function NavArrow({
  href,
  direction,
  label,
}: {
  href: string | null;
  direction: "prev" | "next";
  label: string;
}) {
  const base =
    "flex items-center justify-center h-9 w-9 rounded-full border border-[color:var(--color-border)] transition-colors";
  if (href === null) {
    return (
      <span className={`${base} opacity-30 cursor-not-allowed`} aria-hidden>
        <Chevron direction={direction} />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={`${base} hover:border-[color:var(--color-accent)] cursor-pointer`}
    >
      <Chevron direction={direction} />
    </Link>
  );
}

function Chevron({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-white"
      aria-hidden
    >
      {direction === "prev" ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 18 15 12 9 6" />
      )}
    </svg>
  );
}
