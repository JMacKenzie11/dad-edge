"use client";

import { useState, type ReactNode } from "react";

/** Overview body that clamps when long, with a Show more / Show less toggle. */
export function CollapsibleText({ children, long }: { children: ReactNode; long: boolean }) {
  const [open, setOpen] = useState(false);
  if (!long) return <>{children}</>;
  return (
    <div>
      <div className={open ? "" : "relative max-h-40 overflow-hidden"}>
        {children}
        {!open ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[color:var(--color-surface)] to-transparent" />
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 font-heading text-xs tracking-widest text-[color:var(--color-accent)]"
      >
        {open ? "SHOW LESS" : "SHOW MORE"}
      </button>
    </div>
  );
}

/** Course Content card body with a collapse control in its header. */
export function CollapsibleCard({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span>
          <span className="block font-heading text-base">{title}</span>
          <span className="block text-xs text-[color:var(--color-text-muted)]">{meta}</span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">{open ? "Collapse" : "Expand"}</span>
      </button>
      {open ? <div className="border-t border-[color:var(--color-border)]">{children}</div> : null}
    </section>
  );
}
