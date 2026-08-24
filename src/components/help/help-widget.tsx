"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getHelpForPage, type HelpResult } from "./actions";
import { useCurrentHelpView } from "./current-view-context";

/**
 * Global Help widget: floating helmet-and-label button, bottom-right,
 * on every authenticated page. On click, opens a slide-in panel
 * showing pre-approved help content for the current page + view +
 * role.
 *
 * No live LLM. No free-form Q&A. Content is fetched via a server
 * action that only returns rows with reviewed=true; a missing row
 * shows an honest "help for this page is on its way" fallback and
 * gets logged to help_content_gaps.
 *
 * Refetches on:
 *   - pathname change (navigating between pages)
 *   - currentView change (ITC stage advancing within the same URL)
 *   - open (in case the row was just approved server-side)
 */
export function HelpWidget({
  role,
}: {
  role: "member" | "leader" | "admin";
}) {
  const pathname = usePathname();
  const { currentView } = useCurrentHelpView();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HelpResult | null>(null);

  const fetchHelp = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHelpForPage({
        pathname,
        view_key: currentView,
        role,
      });
      setResult(res);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [pathname, currentView, role]);

  useEffect(() => {
    if (!open) return;
    fetchHelp();
  }, [open, fetchHelp]);

  return (
    <>
      {/* Floating trigger — helmet icon + Help label, bottom right */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open help"
        className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-30 flex flex-col items-center gap-0.5 p-2 rounded-full bg-[color:var(--color-primary)] shadow-lg hover:brightness-110 transition-all"
      >
        <Image
          src="/brand/mark-white.png"
          alt=""
          width={28}
          height={28}
          className="drop-shadow-sm"
        />
        <span className="text-[9px] font-heading tracking-widest text-white leading-none">
          HELP
        </span>
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-panel-title"
            className="fixed z-50 bottom-0 right-0 md:bottom-6 md:right-6 w-full md:w-[420px] max-h-[85vh] md:max-h-[70vh] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-t-[var(--radius-card)] md:rounded-[var(--radius-card)] shadow-2xl flex flex-col"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--color-border)]">
              <div className="flex items-center gap-2">
                <Image
                  src="/brand/mark-white.png"
                  alt=""
                  width={20}
                  height={20}
                />
                <h2
                  id="help-panel-title"
                  className="font-heading text-sm"
                >
                  {loading
                    ? "Loading…"
                    : result?.status === "found"
                      ? result.title
                      : "Help"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close help"
                className="h-8 w-8 flex items-center justify-center rounded-md text-[color:var(--color-text-muted)] hover:text-white hover:bg-[color:var(--color-bg)]"
              >
                ×
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
              {loading ? (
                <p className="text-[color:var(--color-text-muted)]">
                  Loading…
                </p>
              ) : result?.status === "found" ? (
                <HelpBody sections={result.sections} />
              ) : (
                <p className="text-[color:var(--color-text-muted)]">
                  Help for this page is on its way.
                </p>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}

function HelpBody({
  sections,
}: {
  sections: Array<{ what_its_for: string; steps: string[] }>;
}) {
  return (
    <ol className="space-y-4 list-none">
      {sections.map((s, i) => (
        <li
          key={i}
          className="pl-3 border-l-2 border-[color:var(--color-primary)]/40"
        >
          <p className="text-[color:var(--color-text-muted)] italic mb-2">
            {s.what_its_for}
          </p>
          <ol className="list-decimal ml-5 space-y-1.5 text-white/90">
            {s.steps.map((step, j) => (
              <li key={j}>{renderBold(step)}</li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/**
 * Inline `**bold**` renderer for the step text. No other formatting.
 */
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}
