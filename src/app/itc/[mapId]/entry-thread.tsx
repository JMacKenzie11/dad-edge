"use client";

import { useState, useTransition } from "react";
import type { ChipTarget } from "@/lib/itc/chip-target";
import type { ItcMessage } from "@/lib/itc/maps";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { switchMapPillar } from "../actions";
import { useConfirm } from "./use-confirm";

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
  pillarSwitchMapId,
  currentPillarCode,
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
  /** When present + the coach's chip payload includes
   *  suggested_pillar, render a "Switch this map to [Pillar]"
   *  action button that swaps the map's pillar_code via the
   *  switchMapPillar server action. Only the goal thread passes
   *  this — the coach only sets suggested_pillar on cross-pillar
   *  goal leaks. */
  pillarSwitchMapId?: string;
  /** Passed alongside pillarSwitchMapId so the switch button can
   *  suppress itself once the map has already been swapped to the
   *  suggested pillar. Old coach messages keep their suggested_pillar
   *  chip forever; without this check the button lingers as a stale
   *  "Switch this map to Movement →" when the map is already Movement. */
  currentPillarCode?: PillarCode;
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
          pillarSwitchMapId={pillarSwitchMapId}
          currentPillarCode={currentPillarCode}
        />
      ))}
    </div>
  );
}

type ChipPayload = {
  refinement?: string;
  suggestions?: string[];
  suggested_pillar?: PillarCode;
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
  pillarSwitchMapId,
  currentPillarCode,
}: {
  message: ItcMessage;
  chipTarget: ChipTarget;
  entryId?: string;
  pillarSwitchMapId?: string;
  currentPillarCode?: PillarCode;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-md bg-[color:var(--color-primary)]/20 px-3 py-2 text-sm leading-relaxed">
        {message.content}
      </div>
    );
  }
  const { prose, chips } = extractChipPayload(message.content);
  const hasFillChips = Boolean(
    chips && (chips.refinement || (chips.suggestions?.length ?? 0) > 0),
  );
  const showSwitchPillar = Boolean(
    chips?.suggested_pillar &&
      pillarSwitchMapId &&
      chips.suggested_pillar !== currentPillarCode,
  );
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-[color:var(--color-primary)]/25 border-l-[3px] border-l-[color:var(--color-primary)]/70 bg-[color:var(--color-primary)]/[0.10] px-3 py-2 text-sm leading-relaxed">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-primary)]/90 mb-1">
          Coach
        </div>
        <div className="whitespace-pre-wrap">{prose}</div>
      </div>
      {hasFillChips ? (
        <div className="flex flex-wrap gap-2">
          {chips!.refinement ? (
            <ChipButton
              value={chips!.refinement}
              target={chipTarget}
              entryId={entryId}
            />
          ) : null}
          {chips!.suggestions?.map((s, i) => (
            <ChipButton
              key={i}
              value={s}
              target={chipTarget}
              entryId={entryId}
            />
          ))}
        </div>
      ) : null}
      {showSwitchPillar ? (
        <SwitchPillarButton
          mapId={pillarSwitchMapId!}
          pillarCode={chips!.suggested_pillar!}
        />
      ) : null}
    </div>
  );
}

/**
 * "Switch this map to [Pillar]" action button. Rendered when the
 * coach's reaction included a suggested_pillar (only fires on
 * cross-pillar goal leaks). Distinct styling from the fill chips —
 * this is a state change, not a wording swap.
 */
function SwitchPillarButton({
  mapId,
  pillarCode,
}: {
  mapId: string;
  pillarCode: PillarCode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();
  const target = PILLAR_BY_CODE[pillarCode];

  async function onClick() {
    const ok = await confirm({
      title: `Switch this map to ${target.label}?`,
      body: `Your goal, behaviors, and everything else on this map stay. The pillar label changes to ${target.label} (${target.domain}). You can reword the goal now that the map's on the right pillar.`,
      confirmLabel: `Switch to ${target.label}`,
    });
    if (!ok) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("pillar_code", pillarCode);
    startTransition(async () => {
      const res = await switchMapPillar(fd);
      if (!res.ok) setError(res.reason ?? "Could not switch pillar.");
    });
  }

  return (
    <>
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded-md border border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/[0.15] px-3 py-2 text-sm font-semibold text-white hover:bg-[color:var(--color-primary)]/[0.25] disabled:opacity-50"
        >
          {pending
            ? `Switching to ${target.label}…`
            : `Switch this map to ${target.label} →`}
        </button>
        {error ? (
          <span className="text-xs text-[color:var(--color-danger)]">
            {error}
          </span>
        ) : null}
      </div>
    </>
  );
}

function ChipButton({
  value,
  target,
  entryId,
}: {
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
      title="Tap to use in the input"
    >
      {value}
      <span className="sr-only"> (tap to use in the input above)</span>
    </button>
  );
}
