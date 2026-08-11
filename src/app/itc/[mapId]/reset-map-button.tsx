"use client";

import { useTransition } from "react";
import { resetMap } from "../actions";

export function ResetMapButton({ mapId }: { mapId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        const ok = window.confirm(
          "Clear this map and start over? All messages, goal, and behaviors will be deleted. This cannot be undone.",
        );
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
  );
}
