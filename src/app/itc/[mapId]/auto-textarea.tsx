"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Textarea that auto-grows to fit its content. Used everywhere in the
 * ITC surfaces where the coachee reads / edits pre-drafted or typed
 * content whose length is hard to predict (worries, commitments,
 * assumption drafts, test-design fields, results-form fields).
 *
 * Fixed `rows` was clipping text and forcing internal scroll bars
 * inside the field, which read as broken.
 *
 * Implementation: on every value change (and on initial mount),
 * measure scrollHeight and set inline height. `useLayoutEffect`
 * (not useEffect) so the sizing happens before paint — no flicker
 * on first render with a pre-populated value.
 */
export const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    /** Minimum rendered height in text rows. Content shorter than this
     *  still gets the min-height so short single-line inputs don't
     *  look weirdly compressed. Default 2. */
    minRows?: number;
  }
>(function AutoTextarea({ minRows = 2, style, value, ...rest }, forwardedRef) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  // Merge the forwarded ref with our internal one so callers can still
  // .focus() / .blur() etc.
  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  // Compute-and-apply intrinsic height. Called on mount and after any
  // value change.
  const resize = () => {
    const el = innerRef.current;
    if (!el) return;
    // Reset to "auto" first so scrollHeight reflects only the content,
    // not the previous set height.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Layout effect so the sizing lands before paint on initial render
  // with a pre-populated value (avoids a flash of clipped content).
  useLayoutEffect(resize, [value]);

  // Also resize on window resize (font metrics / container width can
  // change and shift wrapping).
  useEffect(() => {
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <textarea
      {...rest}
      ref={setRef}
      value={value}
      rows={minRows}
      onInput={(e) => {
        // Sync sizing on every keystroke — cheaper than a controlled
        // onChange re-render because scrollHeight is O(1)-ish.
        resize();
        rest.onInput?.(e);
      }}
      style={{
        // Prevent the internal scrollbar from ever showing — we grow
        // instead. Passed via inline style so consumers can still add
        // their own via className without conflict.
        overflow: "hidden",
        resize: "none",
        ...style,
      }}
    />
  );
});
