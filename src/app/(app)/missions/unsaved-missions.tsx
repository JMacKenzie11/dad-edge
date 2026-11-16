"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/**
 * Missions he typed that didn't save, and why (Jason, 2026-11-16).
 *
 * An add-mission box that can't save (a [blank] left in, too short, no
 * day picked) says so in one small line and keeps the text only on his
 * phone. Scott Zemens left the page three times thinking his missions
 * had saved and lost them. Now leaving the page with one of those
 * stops him with a popup: which missions, the reason for each, and a
 * button back to them.
 *
 * Every link on the page goes through the check (bottom nav, header,
 * week arrows): a click on one is held while anything is unsaved.
 * Closing the tab gets the browser's own "leave this page?" prompt.
 */

export type UnsavedMission = {
  /** "BOND", "GOAL 1 · VITALITY". */
  where: string;
  text: string;
  reason: string;
  /** Scroll to the box and put the cursor in it. */
  focus: () => void;
};

type Report = (key: string, mission: UnsavedMission | null) => void;

const Ctx = createContext<Report>(() => {});

/** Each add-mission box calls this with its unsaved mission, or null. */
export function useReportUnsaved(): Report {
  return useContext(Ctx);
}

export function UnsavedMissionsGuard({ children }: { children: ReactNode }) {
  const missions = useRef(new Map<string, UnsavedMission>());
  const [held, setHeld] = useState<{ href: string; list: UnsavedMission[] } | null>(null);
  const router = useRouter();

  const report = useCallback<Report>((key, mission) => {
    if (mission) missions.current.set(key, mission);
    else missions.current.delete(key);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (missions.current.size === 0) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      const here = new URL(location.href);
      if (to.origin === here.origin && to.pathname === here.pathname && to.search === here.search) return;
      // Held before Next's link handler runs (capture phase, on document).
      e.preventDefault();
      e.stopPropagation();
      setHeld({ href: to.origin === here.origin ? to.pathname + to.search + to.hash : to.href, list: [...missions.current.values()] });
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (missions.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const goBack = () => {
    const first = held?.list[0];
    setHeld(null);
    first?.focus();
  };
  const leave = () => {
    const href = held!.href;
    setHeld(null);
    missions.current.clear();
    if (href.startsWith("/")) router.push(href);
    else location.href = href;
  };

  return (
    <Ctx.Provider value={report}>
      {children}
      {held ? <UnsavedPopup list={held.list} onBack={goBack} onLeave={leave} /> : null}
    </Ctx.Provider>
  );
}

function UnsavedPopup({ list, onBack, onLeave }: { list: UnsavedMission[]; onBack: () => void; onLeave: () => void }) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack]);

  const one = list.length === 1;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70" role="presentation" onClick={onBack}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-[var(--radius-card)] border border-[color:var(--color-danger)] bg-[color:var(--color-surface)] p-5 shadow-2xl"
      >
        <h2 id="unsaved-title" className="text-base font-semibold text-white">
          {one ? "This mission isn't saved" : `These ${list.length} missions aren't saved`}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          {one ? "If you leave now, it's gone." : "If you leave now, they're gone."}
        </p>
        <ul className="mt-4 space-y-3">
          {list.map((m, i) => (
            <li key={i} className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
              <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">{m.where}</p>
              <p className="mt-1 text-sm text-[color:var(--color-text)] line-clamp-2">{m.text}</p>
              <p className="mt-1 text-[13px] text-[color:var(--color-danger)]">Not saved: {m.reason}</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={backRef}
            type="button"
            onClick={onBack}
            className="min-h-11 rounded-md px-4 py-2 text-sm font-semibold text-white bg-[color:var(--color-primary)] hover:opacity-90"
          >
            {one ? "Go back and fix it" : "Go back and fix them"}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="min-h-11 rounded-md border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-white/5"
          >
            Leave without saving
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
