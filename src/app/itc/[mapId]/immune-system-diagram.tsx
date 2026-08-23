import type { ItcCommitment } from "@/lib/itc/maps";

/**
 * Side-by-side "immune system" visual, rendered above the walkthrough
 * narrative on the immune_system section. Puts the Improvement Goal
 * (Column 1) opposite the Competing Commitments (Column 3) with an
 * opposing-arrows icon between them, so the coachee sees the shape of
 * the conflict before he reads the narrative that explains it.
 *
 * On very narrow screens the layout stacks — but the arrows rotate to
 * a vertical form so the "these are pulling against each other" read
 * stays intact.
 */
export function ImmuneSystemDiagram({
  improvementGoal,
  commitments,
}: {
  improvementGoal: string | null;
  commitments: ItcCommitment[];
}) {
  if (!improvementGoal || commitments.length === 0) return null;
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-black/20 p-4 sm:p-5">
      <div className="text-[10px] uppercase tracking-widest text-[color:var(--color-text-muted)] mb-3 text-center">
        Your immune system, at a glance
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 sm:gap-4 items-stretch">
        <div className="rounded-md border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/10 p-3 flex flex-col">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-[color:var(--color-primary)] mb-1.5">
            Improvement Goal
          </div>
          <div className="text-sm leading-relaxed text-white/95">
            {improvementGoal}
          </div>
        </div>

        <div className="flex sm:flex-col items-center justify-center gap-1 py-1 sm:py-0 sm:px-1">
          <OpposingArrowsIcon />
          <span className="text-[10px] uppercase tracking-widest text-[color:var(--color-text-muted)] whitespace-nowrap">
            Pulling against
          </span>
        </div>

        <div className="rounded-md border border-[color:var(--color-warning)]/50 bg-[color:var(--color-warning)]/10 p-3 flex flex-col">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-[color:var(--color-warning)] mb-1.5">
            Competing Commitments
          </div>
          <ol className="list-decimal ml-4 space-y-1.5 text-sm leading-relaxed text-white/95">
            {commitments.map((c) => (
              <li key={c.id}>{c.text}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function OpposingArrowsIcon() {
  return (
    <svg
      viewBox="0 0 40 24"
      className="h-5 w-9 sm:h-6 sm:w-10 text-[color:var(--color-text-muted)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8 L14 8 M10 4 L14 8 L10 12" />
      <path d="M38 16 L26 16 M30 12 L26 16 L30 20" />
    </svg>
  );
}
