"use client";

import { useTransition } from "react";
import { resetMap } from "../actions";
import { useConfirm } from "./use-confirm";

export function ResetMapButton({ mapId }: { mapId: string }) {
  const [pending, startTransition] = useTransition();
  const [dialog, confirm] = useConfirm();

  return (
    <>
      {dialog}
      <form
        action={async (fd) => {
          const ok = await confirm({
            title: "Clear this map and start over?",
            body: "Everything on it will be deleted: your goal, behaviors, worries, commitments, assumptions, tests, and results. This cannot be undone.",
            confirmLabel: "Clear map",
            destructive: true,
          });
          if (!ok) return;
          startTransition(() => resetMap(fd));
        }}
      >
        <input type="hidden" name="map_id" value={mapId} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-50"
        >
          {pending ? "Clearing…" : "Clear map"}
        </button>
      </form>
    </>
  );
}
