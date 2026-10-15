/**
 * Help goes live without a human approval step (Jason, 2026-10-16;
 * DECISIONS.md "Help publishes itself"). The voice lint is the gate:
 * a draft that passes it is published, a draft that fails it is never
 * written, so the page keeps whatever help it already had.
 *
 * Shared by `npm run help:generate`, the nightly regen job and the
 * REGEN buttons. No imports, so the scripts can load it directly.
 */

export const MAX_GENERATION_ATTEMPTS = 3;

export type DraftOutcome<T> =
  | { ok: true; draft: T; attempts: number }
  | { ok: false; reason: string; attempts: number };

/**
 * Generate until a draft passes the voice lint, up to `max` tries. A
 * thrown attempt (the model's output not matching the schema, which
 * happens now and then) counts as a try too.
 */
export async function firstCleanDraft<T>(
  attempt: () => Promise<T>,
  passesVoiceLint: (draft: T) => boolean,
  max: number = MAX_GENERATION_ATTEMPTS,
): Promise<DraftOutcome<T>> {
  let lastReason = "no attempts made";
  for (let i = 1; i <= max; i++) {
    try {
      const draft = await attempt();
      if (passesVoiceLint(draft)) return { ok: true, draft, attempts: i };
      lastReason = "failed the voice check";
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, reason: `${lastReason} (${max} tries)`, attempts: max };
}

/**
 * The model sometimes writes an en dash in a range ("1–10") or a
 * compound. The voice rules ban it, but a plain hyphen is fine, so swap
 * it before the lint instead of throwing the draft away. Em dashes
 * still fail the lint: those stand in for a comma or a full stop, and
 * the sentence needs rewriting.
 */
export function withHyphens<T extends { title: string; sections: Array<{ what_its_for: string; steps: string[] }> }>(
  draft: T,
): T {
  const fix = (s: string) => s.replace(/\s*–\s*/g, "-");
  return {
    ...draft,
    title: fix(draft.title),
    sections: draft.sections.map((sec) => ({ ...sec, what_its_for: fix(sec.what_its_for), steps: sec.steps.map(fix) })),
  };
}

/** Columns that mark a freshly generated row as live. `reviewed` is the
 *  flag the help widget serves on; it now means "published". */
export function publishedColumns(now: Date = new Date()) {
  const at = now.toISOString();
  return {
    voice_lint_passed: true,
    reviewed: true,
    reviewed_by: null,
    reviewed_at: at,
    generated_at: at,
  };
}
