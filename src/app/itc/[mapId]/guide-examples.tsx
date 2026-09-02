import {
  ASSUMPTION_EXAMPLES,
  WORRY_EXAMPLES,
  type GuidePair,
} from "@/lib/itc/guide-examples";

/**
 * Collapsed panel of worked pairs from the coaching guides, on the
 * two columns that ask the coachee to connect one entry to another.
 *
 * Thought joggers, not a reading assignment. Shut by default, one
 * line of prose per side, and it sits BELOW the input so a man who
 * already knows what he wants to write never has to travel past it.
 * The pairs themselves live in src/lib/itc/guide-examples.ts with
 * their citations; this file only lays them out.
 *
 * Uses the native <details> disclosure rather than useState, so the
 * open/shut behavior needs no JavaScript of its own and is keyboard
 * and screen-reader accessible for free. (The file still lands in
 * the client bundle: its only callers are inside map-canvas, which
 * is a client component.)
 */
export function GuideExamples({
  column,
}: {
  column: "worries" | "assumptions";
}) {
  const worries = column === "worries";
  const pairs: GuidePair[] = worries ? WORRY_EXAMPLES : ASSUMPTION_EXAMPLES;
  const fromLabel = worries ? "The behavior" : "The competing commitment";
  const toLabel = worries ? "What he feared about doing the opposite" : "The Big Assumption underneath it";
  const summary = worries
    ? "Three worries from the guides' own maps"
    : "Three Big Assumptions from the guides' own maps";

  return (
    <details className="group mt-4 rounded-md border border-[color:var(--color-border)] bg-black/10">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-[color:var(--color-text-muted)] hover:text-white">
        <span className="inline-block w-3 transition-transform group-open:rotate-90">
          ›
        </span>{" "}
        {summary}
      </summary>
      <div className="space-y-3 border-t border-[color:var(--color-border)] px-3 py-3">
        {pairs.map((p) => (
          <div key={p.to} className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--color-text-muted)]/60">
              {fromLabel}
            </div>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              {p.from}
            </p>
            <div className="pt-1 text-[10px] uppercase tracking-widest text-[color:var(--color-primary)]/80">
              {toLabel}
            </div>
            <p className="text-sm text-white/90">{p.to}</p>
            <p className="text-[10px] italic text-[color:var(--color-text-muted)]/50">
              {p.source}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}
