"use client";

import { useTransition } from "react";
import { resetMap } from "../actions";
import { useConfirm } from "./use-confirm";

/**
 * Clear-map button. Wrapping the reset in a native <form action={fn}>
 * broke after the confirm dialog refactor — making the form action
 * async so we could await confirm() caused React to consider the
 * form's promise settled before the server action actually ran, and
 * the redirect from resetMap() got dropped in the stale form context.
 *
 * Simpler pattern: plain button + onClick + direct server action call.
 * useTransition still gives us the pending state for the label.
 */
export function ResetMapButton({ mapId }: { mapId: string }) {
  const [pending, startTransition] = useTransition();
  const [dialog, confirm] = useConfirm();

  async function onClick() {
    const ok = await confirm({
      title: "Clear this map and start over?",
      body: "Everything on it will be deleted: your goal, behaviors, worries, commitments, assumptions, tests, and results. This cannot be undone.",
      confirmLabel: "Clear map",
      destructive: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("map_id", mapId);
    startTransition(async () => {
      await resetMap(fd);
    });
  }

  return (
    <>
      {dialog}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-50"
      >
        {pending ? "Clearing…" : "Clear map"}
      </button>
    </>
  );
}
