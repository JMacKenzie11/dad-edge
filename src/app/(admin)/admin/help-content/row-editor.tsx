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
export function RowEditor({
  id,
  title,
  sections,
  voiceLintPassed,
}: {
  id: string;
  title: string;
  sections: Section[];
  voiceLintPassed: boolean;
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
      <Preview title={title} sections={sections} />
      <div className="flex flex-wrap gap-2 items-center">
        {!voiceLintPassed ? (
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-warning)]">
            VOICE LINT FAILED — REGEN OR EDIT
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

function Preview({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <div className="text-sm">
      <p className="font-heading text-base mb-2">{title}</p>
      <ol className="space-y-3 list-none">
        {sections.map((s, i) => (
          <li key={i} className="pl-3 border-l-2 border-[color:var(--color-primary)]/40">
            <p className="text-[color:var(--color-text-muted)] italic mb-1">
              {s.what_its_for}
            </p>
            <ol className="list-decimal ml-5 space-y-0.5">
              {s.steps.map((step, j) => (
                <li key={j}>{renderBold(step)}</li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
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
