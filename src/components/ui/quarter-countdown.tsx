import { daysUntilQuarterEnd, getCurrentQuarter } from "@/lib/scoring/quarters";

/**
 * Shared quarter deadline countdown, rendered on /missions header,
 * /goals header, and inside goal cards. UTC canonical quarter per
 * `getCurrentQuarter`; identical treatment across surfaces so the
 * "days left" number is always the same.
 */
export function QuarterCountdown({
  now = new Date(),
  className = "text-sm text-[color:var(--color-text-muted)]",
}: {
  now?: Date;
  className?: string;
}) {
  const q = getCurrentQuarter(now);
  const days = daysUntilQuarterEnd(now);
  return (
    <p className={className}>
      {q.label} ends in {days} day{days === 1 ? "" : "s"}.
    </p>
  );
}
