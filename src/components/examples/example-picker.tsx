"use client";

import type { RefObject } from "react";
import { firstBlankRange, type Example } from "@/lib/examples/library";

/**
 * "START FROM AN EXAMPLE": prewritten goals or missions for one domain
 * (src/lib/examples/library.ts). Tapping one hands its text to the form;
 * every word stays his to edit.
 *
 * onMouseDown is cancelled so a tap doesn't take focus from the text
 * box: the add-mission box saves or closes when it loses focus, which
 * would happen before the tap landed.
 */
export function ExamplePicker({
  examples,
  pickedId,
  onPick,
}: {
  examples: Example[];
  pickedId: string | null;
  onPick: (example: Example) => void;
}) {
  if (examples.length === 0) return null;
  return (
    <div className="space-y-1.5" role="group" aria-label="Start from an example">
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        START FROM AN EXAMPLE
      </p>
      <ul className="space-y-1.5">
        {examples.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => onPick(e)}
              aria-pressed={pickedId === e.id}
              className={`w-full min-h-11 text-left px-3 py-2 rounded-md border text-[13px] leading-snug transition-colors ${
                pickedId === e.id
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10 text-[color:var(--color-text)]"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)]/85 hover:border-[color:var(--color-primary)]"
              }`}
            >
              {e.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
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
