"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  approveHelpContent,
  editAndApproveHelpContent,
  regenerateHelpContent,
} from "./actions";

type Section = { what_its_for: string; steps: string[] };

/**
 * Inline row editor for a single unreviewed help_content entry.
 *
 * Renders:
 *   - Preview of title + sections + steps (default view)
 *   - Approve / Edit / Regenerate buttons
 *   - On "Edit": expands to a title input + a JSON textarea over
 *     sections; save runs editAndApproveHelpContent which re-lints.
 *
 * JSON textarea is deliberate — a proper section editor with add /
 * remove / reorder would add real UI work with little payoff for a
 * one-review-per-piece workflow. Fluent English JSON edits are
 * fine for a platform admin doing this once per piece.
 */
type LintHit = {
  rule: string;
  match: string;
  section_index: number;
  step_index: number | null;
};

export function RowEditor({
  id,
  title,
  sections,
  voiceLintPassed,
  lintHits = [],
}: {
  id: string;
  title: string;
  sections: Section[];
  voiceLintPassed: boolean;
  lintHits?: LintHit[];
}) {
  const [editing, setEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [editedJson, setEditedJson] = useState(
    JSON.stringify(sections, null, 2),
  );

  if (editing) {
    return (
      <form
        action={editAndApproveHelpContent}
        className="space-y-3 p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-primary)]/60"
      >
        <input type="hidden" name="id" value={id} />
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            TITLE
          </span>
          <input
            name="title"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            className="mt-1 w-full h-10 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            SECTIONS (JSON)
          </span>
          <textarea
            name="sections_json"
            value={editedJson}
            onChange={(e) => setEditedJson(e.target.value)}
            rows={14}
            className="mt-1 w-full px-3 py-2 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-xs font-mono"
          />
          <span className="mt-1 block text-[10px] text-[color:var(--color-text-muted)]">
            Array of {"{ what_its_for, steps: [] }"}. Save re-runs the voice lint.
          </span>
        </label>
        <div className="flex gap-2">
          <SubmitButton
            variant="primary"
            label="SAVE AND APPROVE"
            pendingLabel="SAVING…"
            className="text-xs"
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-11 px-4 rounded-md bg-transparent text-[color:var(--color-text-muted)] hover:text-white font-heading text-xs tracking-widest"
          >
            CANCEL
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <Preview
        title={title}
        sections={sections}
        lintHits={voiceLintPassed ? [] : lintHits}
      />
      {!voiceLintPassed && lintHits.length > 0 ? (
        <div className="p-3 rounded-md border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/[0.08]">
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-warning)] mb-2">
            VOICE LINT FAILED · {lintHits.length} HIT
            {lintHits.length === 1 ? "" : "S"}
          </p>
          <ul className="space-y-1 text-xs">
            {lintHits.map((h, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[color:var(--color-text-muted)]"
              >
                <span className="font-mono text-[10px] shrink-0 text-[color:var(--color-warning)]">
                  {locationLabel(h)}
                </span>
                <span>
                  <span className="font-mono text-white">
                    "{h.match}"
                  </span>{" "}
                  <span className="text-[color:var(--color-text-muted)]/80">
                    · {h.rule}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 items-center">
        {!voiceLintPassed && lintHits.length === 0 ? (
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-warning)]">
            VOICE LINT FAILED - REGEN OR EDIT
          </span>
        ) : null}
        <div className="flex gap-2 ml-auto">
          <form action={approveHelpContent} className="inline">
            <input type="hidden" name="id" value={id} />
            <SubmitButton
              variant="primary"
              label="APPROVE"
              pendingLabel="…"
              className="h-9 px-3 text-xs"
              disabled={!voiceLintPassed}
            />
          </form>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-9 px-3 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:text-white font-heading text-xs tracking-widest"
          >
            EDIT
          </button>
          <form action={regenerateHelpContent} className="inline">
            <input type="hidden" name="id" value={id} />
            <SubmitButton
              variant="ghost"
              label="REGEN"
              pendingLabel="…"
              className="h-9 px-3 text-xs"
            />
          </form>
        </div>
      </div>
    </div>
  );
}

function Preview({
  title,
  sections,
  lintHits,
}: {
  title: string;
  sections: Section[];
  lintHits: LintHit[];
}) {
  return (
    <div className="text-sm">
      <p className="font-heading text-base mb-2">{title}</p>
      <ol className="space-y-3 list-none">
        {sections.map((s, i) => {
          const whatItsForHits = lintHits.filter(
            (h) => h.section_index === i && h.step_index === null,
          );
          return (
            <li
              key={i}
              className="pl-3 border-l-2 border-[color:var(--color-primary)]/40"
            >
              <p className="text-[color:var(--color-text-muted)] italic mb-1">
                {highlightHits(s.what_its_for, whatItsForHits)}
              </p>
              <ol className="list-decimal ml-5 space-y-0.5">
                {s.steps.map((step, j) => {
                  const stepHits = lintHits.filter(
                    (h) => h.section_index === i && h.step_index === j,
                  );
                  return (
                    <li key={j}>
                      {highlightHits(step, stepHits, /* alsoBold */ true)}
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function locationLabel(hit: LintHit): string {
  const s = `§${hit.section_index + 1}`;
  return hit.step_index === null ? s : `${s}.${hit.step_index + 1}`;
}

/**
 * Render text with two overlays:
 *  - `**bold**` markdown → <strong>
 *  - any lintHit `match` → highlighted background (case-insensitive
 *    substring match, first occurrence per hit)
 */
function highlightHits(
  text: string,
  hits: LintHit[],
  alsoBold = true,
): React.ReactNode {
  if (hits.length === 0) {
    return alsoBold ? renderBold(text) : text;
  }
  // Build a set of char ranges to highlight, then splice.
  const ranges: Array<{ start: number; end: number }> = [];
  for (const h of hits) {
    const idx = text.toLowerCase().indexOf(h.match.toLowerCase());
    if (idx >= 0) ranges.push({ start: idx, end: idx + h.match.length });
  }
  ranges.sort((a, b) => a.start - b.start);

  const parts: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      parts.push({ text: text.slice(cursor, r.start), highlight: false });
    }
    parts.push({ text: text.slice(r.start, r.end), highlight: true });
    cursor = r.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), highlight: false });
  }

  return parts.map((p, i) =>
    p.highlight ? (
      <mark
        key={i}
        className="bg-[color:var(--color-warning)]/30 text-white px-0.5 rounded-sm"
      >
        {alsoBold ? renderBold(p.text) : p.text}
      </mark>
    ) : (
      <span key={i}>{alsoBold ? renderBold(p.text) : p.text}</span>
    ),
  );
}

/**
 * Very small markdown-bold renderer for `**foo**` in step text.
 * Kept local rather than pulling a markdown lib in — nothing else
 * in the content model needs formatting.
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
