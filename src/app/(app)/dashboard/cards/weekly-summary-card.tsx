"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import type {
  WeeklySummaryBody,
  WeeklySummaryState,
} from "@/lib/weekly-summary/state";

/**
 * Weekly recap card, top of /dashboard.
 *
 * Four states from the server-resolved WeeklySummaryState:
 *   - ready       → render the persisted body statically
 *   - generating  → open a POST to /api/summary/weekly/stream and
 *                   render text as it arrives (typewriter feel is
 *                   natural token-arrival rhythm, no artificial
 *                   per-char delay)
 *   - not_yet     → placeholder with the date the summary appears
 *   - no_activity → friendly nudge instead of a fake recap
 *
 * Once streaming completes we split the emitted text on [HIGHLIGHT] /
 * [WHAT WORKED] / [OPPORTUNITY] markers and lay it out with the same
 * three-section rhythm as a persisted row — so first-view and repeat-
 * view look the same after the reveal finishes.
 */
export function WeeklySummaryCard({ state }: { state: WeeklySummaryState }) {
  if (state.status === "ready") {
    return (
      <SummaryShell weekStart={state.weekStart}>
        <Sections body={state.body} />
      </SummaryShell>
    );
  }
  if (state.status === "not_yet") {
    return (
      <SummaryShell weekStart={state.weekStart}>
        <p className="text-sm text-[color:var(--color-text-muted)] italic">
          Your week wraps {formatFriendly(state.wrapsAt)}. Your recap shows up
          here then.
        </p>
      </SummaryShell>
    );
  }
  if (state.status === "no_activity") {
    return (
      <SummaryShell weekStart={state.weekStart}>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          No check-ins last week. Start logging this week and the recap for it
          will show up here after it wraps.
        </p>
      </SummaryShell>
    );
  }
  return <StreamingSummary weekStart={state.weekStart} />;
}

function StreamingSummary({ weekStart }: { weekStart: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Guard against React strict-mode double-mount kicking off two POSTs.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/summary/weekly/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ weekStart }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const errBody = await res.text().catch(() => "");
          setError(errBody || `Stream error (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          setText((prev) => prev + decoder.decode(value, { stream: true }));
        }
        setDone(true);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "unknown error");
      }
    })();

    return () => controller.abort();
  }, [weekStart]);

  const sections = splitSections(text);

  return (
    <SummaryShell weekStart={weekStart}>
      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : (
        <div className="space-y-4">
          <RevealSection
            label="HIGHLIGHT"
            text={sections.highlight}
            emphasize
            showCursor={!done && sections.opportunity.length === 0 && sections.what_worked.length === 0}
          />
          {sections.what_worked ? (
            <RevealSection
              label="WHAT WORKED"
              text={sections.what_worked}
              showCursor={!done && sections.opportunity.length === 0}
            />
          ) : null}
          {sections.opportunity ? (
            <RevealSection
              label="OPPORTUNITY"
              text={sections.opportunity}
              showCursor={!done}
            />
          ) : null}
        </div>
      )}
    </SummaryShell>
  );
}

function SummaryShell({
  weekStart,
  children,
}: {
  weekStart: string;
  children: React.ReactNode;
}) {
  return (
    <section className="p-5 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border-2 border-[color:var(--color-accent)]/70">
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-accent)]">
        WEEK OF {formatFriendly(weekStart).toUpperCase()}
      </p>
      <h2 className="font-heading text-xl mt-1 mb-4">Your week, in short.</h2>
      {children}
    </section>
  );
}

function Sections({ body }: { body: WeeklySummaryBody }) {
  return (
    <div className="space-y-4">
      <RevealSection label="HIGHLIGHT" text={body.highlight} emphasize />
      <RevealSection label="WHAT WORKED" text={body.what_worked} />
      <RevealSection label="OPPORTUNITY" text={body.opportunity} />
    </div>
  );
}

function RevealSection({
  label,
  text,
  emphasize,
  showCursor,
}: {
  label: string;
  text: string;
  emphasize?: boolean;
  showCursor?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-1">
        {label}
      </p>
      <p
        className={
          emphasize
            ? "text-base leading-snug text-white"
            : "text-sm leading-relaxed text-[color:var(--color-text)]"
        }
      >
        {text}
        {showCursor ? <BlinkCursor /> : null}
      </p>
    </div>
  );
}

/** Simple blinking block cursor for the streaming state. Pure CSS
 *  animation — no per-frame state churn. */
function BlinkCursor() {
  return (
    <span
      aria-hidden
      className="inline-block w-[0.5em] h-[1em] align-[-0.15em] ml-0.5 bg-[color:var(--color-accent)] animate-pulse"
    />
  );
}

function formatFriendly(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : format(d, "MMM d");
}

/**
 * Split streaming text on the section markers. Tolerant to partial
 * markers (the model may have only emitted "[HIGHLIGHT]\nsome text\n[WHAT"
 * so far — we still want to show HIGHLIGHT). Mirrors the server
 * parser but works on the growing buffer.
 */
function splitSections(text: string): {
  highlight: string;
  what_worked: string;
  opportunity: string;
} {
  const grab = (label: string, next: string | null): string => {
    const start = text.indexOf(`[${label}]`);
    if (start < 0) return "";
    const contentStart = start + `[${label}]`.length;
    // Even if the "next" marker hasn't fully arrived yet, we don't
    // want to render a partial "[WHAT" tail on the highlight — trim
    // any trailing "[" that begins mid-marker.
    let end = next ? text.indexOf(`[${next}]`, contentStart) : -1;
    if (end < 0 && next) {
      const partial = text.lastIndexOf("[", text.length);
      if (partial > contentStart) end = partial;
    }
    const slice = end > 0 ? text.slice(contentStart, end) : text.slice(contentStart);
    return slice.trim();
  };
  return {
    highlight: grab("HIGHLIGHT", "WHAT WORKED"),
    what_worked: grab("WHAT WORKED", "OPPORTUNITY"),
    opportunity: grab("OPPORTUNITY", null),
  };
}
