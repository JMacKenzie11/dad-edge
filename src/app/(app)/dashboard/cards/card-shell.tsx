import type { ReactNode } from "react";

/**
 * Shared card chrome for the dashboard. Every card uses the same
 * border / radius / heading treatment so the page reads as one
 * coherent surface. Empty-state and skeleton variants share the
 * same shell so nothing shifts when data loads.
 */
export function DashboardCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {title.toUpperCase()}
        </p>
        {subtitle ? (
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
            {subtitle}
          </p>
        ) : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

/** Skeleton row inside a card. Same height as a real chart so the
 *  page doesn't jump on load. */
export function CardSkeleton({ title }: { title: string }) {
  return (
    <DashboardCard title={title}>
      <div className="h-56 rounded-md bg-[color:var(--color-border)]/30 animate-pulse" />
    </DashboardCard>
  );
}

/** Card whose data isn't rich enough to draw yet. Explains what will
 *  appear once history builds up. */
export function CardEmpty({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <DashboardCard title={title}>
      <p className="text-sm text-[color:var(--color-text-muted)] italic py-6">
        {message}
      </p>
    </DashboardCard>
  );
}
