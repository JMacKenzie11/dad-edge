"use client";

import { InlineSpinner } from "./form-field";

/**
 * The coach's box under an entry that needs work. Two parts, both
 * persisted on the row by src/lib/itc/fixes.ts:
 *
 *   text — the rendered "what's off" lines (sharpen_text). Same
 *          sentences the column review and the hone banner print for
 *          this entry, so the coachee never reads two versions.
 *   fix  — a rewrite that cleared the same checks (suggested_fix).
 *          Optional: when the drafter couldn't produce one that
 *          passed, the box shows the lines alone and the coachee
 *          writes it himself.
 *
 * "Use this" saves the rewrite through the row's normal save path,
 * which re-scores and clears the box when the new text holds up.
 * Danger tint (red) so "this one needs work" reads unambiguously;
 * the words stay appreciative ("Coach's take", never "broken").
 */
export function CoachFixBox({
  text,
  fix,
  pending,
  onUseFix,
}: {
  text: string;
  fix: string | null;
  pending: boolean;
  onUseFix: (fix: string) => void;
}) {
  return (
    <div className="min-w-0 rounded-md border border-[color:var(--color-danger)]/30 border-l-[3px] border-l-[color:var(--color-danger)]/70 bg-[color:var(--color-danger)]/[0.08] px-3 py-2 text-sm leading-relaxed">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-danger)]/90">
        Coach&apos;s take
      </div>
      <div className="whitespace-pre-wrap break-words text-white/90">{text}</div>
      {fix ? (
        <div className="mt-2 space-y-2 border-t border-[color:var(--color-danger)]/20 pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
            Sharper
          </div>
          <div className="italic text-white/90">{fix}</div>
          <button
            type="button"
            disabled={pending}
            onClick={() => onUseFix(fix)}
            aria-busy={pending ? "true" : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {pending ? <InlineSpinner className="h-3 w-3" /> : null}
            Use this
          </button>
        </div>
      ) : null}
    </div>
  );
}
