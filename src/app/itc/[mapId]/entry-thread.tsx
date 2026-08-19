"use client";

import type { ChipTarget } from "@/lib/itc/chip-target";
import type { ItcMessage } from "@/lib/itc/maps";

/**
 * Inline coaching thread anchored to a specific map entry. Pure
 * render: shows the coach's reaction messages and any chip payload.
 *
 * No reply UI. Under Form-First the user has three ways to change
 * the map — edit the entry input directly, tap a chip, or ask the
 * coach via the dock. Reply-in-thread was a fourth affordance that
 * misled users into thinking their reply text updated the entry;
 * removed to eliminate the ambiguity entirely.
 */
export function EntryThread({
  messages,
  chipTarget,
  entryId,
}: {
  messages: ItcMessage[];
  /** Which input a refinement/suggestion chip in this thread should
   *  fill when tapped. Required — chips without a target are inert
   *  under the routed dispatch model. */
  chipTarget: ChipTarget;
  /** For multi-item columns (behaviors/worries/commitments/
   *  assumptions): the specific entry ID this thread is anchored
   *  to. Refinement chips dispatch with this ID so ONLY that
   *  item's inline input receives the fill. Omit for the goal
   *  thread (single input, unambiguous). */
  entryId?: string;
}) {
  if (messages.length === 0) return null;
  return (
    <div className="pl-3 pt-2 space-y-2">
      {messages.map((m) => (
        <ThreadMessage
          key={m.id}
          message={m}
          chipTarget={chipTarget}
          entryId={entryId}
        />
      ))}
    </div>
  );
}

type ChipPayload = {
  refinement?: string;
  suggestions?: string[];
};

function extractChipPayload(content: string): {
  prose: string;
  chips: ChipPayload | null;
} {
  const fence = /\n?```coach-chips\s*\n([\s\S]*?)\n```\s*$/;
  const match = content.match(fence);
  if (!match) return { prose: content, chips: null };
  const prose = content.slice(0, match.index).trimEnd();
  try {
    return { prose, chips: JSON.parse(match[1]) as ChipPayload };
  } catch {
    return { prose, chips: null };
  }
}

function ThreadMessage({
  message,
  chipTarget,
  entryId,
}: {
  message: ItcMessage;
  chipTarget: ChipTarget;
  entryId?: string;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-md bg-[color:var(--color-primary)]/20 px-3 py-2 text-sm leading-relaxed">
        {message.content}
      </div>
    );
  }
  const { prose, chips } = extractChipPayload(message.content);
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-[color:var(--color-primary)]/25 border-l-[3px] border-l-[color:var(--color-primary)]/70 bg-[color:var(--color-primary)]/[0.10] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
        {prose}
      </div>
      {chips && (chips.refinement || (chips.suggestions?.length ?? 0) > 0) ? (
        <div className="flex flex-wrap gap-2">
          {chips.refinement ? (
            <ChipButton
              label={`Use: "${chips.refinement}"`}
              value={chips.refinement}
              target={chipTarget}
              entryId={entryId}
            />
          ) : null}
          {chips.suggestions?.map((s, i) => (
            <ChipButton
              key={i}
              label={s}
              value={s}
              target={chipTarget}
              entryId={entryId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChipButton({
  label,
  value,
  target,
  entryId,
}: {
  label: string;
  value: string;
  target: ChipTarget;
  entryId?: string;
}) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent("itc-chip-fill", {
        detail: entryId ? { value, target, entryId } : { value, target },
      }),
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-full border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/10 px-3 py-1 text-xs text-white hover:bg-[color:var(--color-primary)]/20"
      title="Use this in the input"
    >
      {label}
    </button>
  );
}
