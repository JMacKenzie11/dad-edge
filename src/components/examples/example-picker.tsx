"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { firstBlankRange, type Example } from "@/lib/examples/library";

/** How many examples are on screen at once (Jason, 2026-11-13). */
export const EXAMPLES_SHOWN = 5;

/**
 * "START FROM AN EXAMPLE": prewritten goals or missions for one domain
 * (src/lib/examples/library.ts). Fifteen per domain, five on screen,
 * in a fresh random order each time the list opens; "Show other
 * examples" brings up the next five. Tapping one hands its text to the
 * form; every word stays his to edit.
 *
 * The list floats over the page, so opening it doesn't push the rest of
 * the form down.
 *
 * Two ways to open it:
 *  - `open`: the parent decides (the add-mission box shows it while the
 *    box is empty).
 *  - `toggle`: a START FROM AN EXAMPLE button opens and closes it (the
 *    goal form). It closes on a pick, Escape or a tap outside.
 *
 * onMouseDown is cancelled on every button so a tap doesn't take focus
 * from the text box: the add-mission box saves or closes when it loses
 * focus, which would happen before the tap landed.
 */
export function ExamplePicker({
  examples,
  pickedId,
  onPick,
  open: openProp = true,
  toggle = false,
}: {
  examples: Example[];
  pickedId: string | null;
  onPick: (example: Example) => void;
  open?: boolean;
  toggle?: boolean;
}) {
  const [openSelf, setOpenSelf] = useState(false);
  const open = toggle ? openSelf : openProp;
  const [order, setOrder] = useState<Example[] | null>(null);
  const [page, setPage] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  // A fresh order each time it opens or the domain changes. Done after
  // mount, not during render, so the server and browser agree.
  useLayoutEffect(() => {
    if (!open) return;
    setOrder(shuffle(examples));
    setPage(0);
  }, [open, examples]);

  useEffect(() => {
    if (!toggle || !openSelf) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpenSelf(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenSelf(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [toggle, openSelf]);

  if (examples.length === 0) return null;
  const pages = Math.ceil(examples.length / EXAMPLES_SHOWN);
  const shown = (order ?? []).slice(page * EXAMPLES_SHOWN, page * EXAMPLES_SHOWN + EXAMPLES_SHOWN);

  return (
    <div ref={root} className="relative">
      {toggle ? (
        <button
          type="button"
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => setOpenSelf((o) => !o)}
          aria-expanded={openSelf}
          className="min-h-11 text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] cursor-pointer"
        >
          START FROM AN EXAMPLE {openSelf ? "▴" : "▾"}
        </button>
      ) : null}
      {open && order ? (
        <div
          role="group"
          aria-label="Start from an example"
          className="absolute left-0 right-0 top-full mt-1 z-[5] p-2 space-y-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-xl shadow-black/40 max-h-[60vh] overflow-y-auto"
        >
          {toggle ? null : (
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              START FROM AN EXAMPLE
            </p>
          )}
          <ul className="space-y-1.5">
            {shown.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    onPick(e);
                    if (toggle) setOpenSelf(false);
                  }}
                  aria-pressed={pickedId === e.id}
                  className={`w-full min-h-11 text-left px-3 py-2 rounded-md border text-[13px] leading-snug transition-colors ${
                    pickedId === e.id
                      ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10 text-[color:var(--color-text)]"
                      : "border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-text)]/85 hover:border-[color:var(--color-primary)]"
                  }`}
                >
                  {e.text}
                </button>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <button
              type="button"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => setPage((p) => (p + 1) % pages)}
              className="w-full min-h-11 text-[11px] font-heading tracking-widest text-[color:var(--color-primary)] cursor-pointer"
            >
              SHOW OTHER EXAMPLES
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Focus the box and select its first [blank], so he types straight over it. */
export function selectFirstBlank(ref: RefObject<HTMLTextAreaElement | null>) {
  // After React has put the new text in the box.
  requestAnimationFrame(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = firstBlankRange(el.value);
    if (range) el.setSelectionRange(range[0], range[1]);
    else el.setSelectionRange(el.value.length, el.value.length);
  });
}
