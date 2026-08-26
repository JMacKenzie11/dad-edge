import Link from "next/link";
import { format, addDays } from "date-fns";

/**
 * Prev / next arrows on /today so a user can hop back to yesterday
 * (or further) and add something they forgot. Bounds:
 *   - forward stops at today (no logging future days)
 *   - backward stops at `earliest` (the day after the community's
 *     most recent locked week — locked weeks are immutable)
 *
 * Server component — no client interactivity needed; anchor tags
 * plus the query param handle everything.
 */
export function DateNavigator({
  date,
  today,
  earliest,
}: {
  date: string;
  today: string;
  earliest: string;
}) {
  const prev = format(addDays(new Date(`${date}T00:00:00Z`), -1), "yyyy-MM-dd");
  const next = format(addDays(new Date(`${date}T00:00:00Z`), 1), "yyyy-MM-dd");
  const canPrev = prev >= earliest;
  const canNext = next <= today;
  const isToday = date === today;

  const dayLabel = format(new Date(`${date}T00:00:00`), "EEEE").toUpperCase();

  return (
    <div className="flex items-center justify-between gap-3">
      <NavArrow
        href={canPrev ? hrefFor(prev, today) : null}
        direction="prev"
        label="Previous day"
      />
      <div className="text-center min-w-0">
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {dayLabel} · {date}
        </p>
        {!isToday ? (
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-accent)] mt-0.5">
            EDITING PAST DAY
          </p>
        ) : null}
      </div>
      <NavArrow
        href={canNext ? hrefFor(next, today) : null}
        direction="next"
        label="Next day"
      />
    </div>
  );
}

function hrefFor(date: string, today: string): string {
  // Clean URL — no ?date= for today itself so refresh / share always
  // lands on the same canonical /today.
  return date === today ? "/today" : `/today?date=${date}`;
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
      <span
        className={`${base} opacity-30 cursor-not-allowed`}
        aria-hidden
      >
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
