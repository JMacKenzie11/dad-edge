import type { ItcStage } from "./stage";

/**
 * Tiny client-side store that broadcasts the current ITC map's stage
 * from the map page to the ItcStageNav in the layout's left rail.
 *
 * Motivation: the nav lives in `/itc/layout.tsx` (above the [mapId]
 * segment), so it can't receive `params.mapId` as a prop and can't
 * subscribe to the page's server-side data. A prior version fetched
 * `/api/itc/maps/[mapId]/current-stage` on mount, but that fetch never
 * re-ran after a stage advance revalidated the page — the nav went
 * stale the moment the coachee crossed a stage boundary.
 *
 * How it works: the map page renders a `CurrentStageBroadcaster` next
 * to `MapCanvas`. On every render (including post-revalidate re-render
 * after an advance) the broadcaster pushes its stage prop into this
 * store. The nav subscribes via `useSyncExternalStore` and re-renders
 * whenever the stage changes.
 */

type State = { mapId: string | null; stage: ItcStage | null };

let state: State = { mapId: null, stage: null };
const listeners = new Set<() => void>();

export const currentStageStore = {
  get(): State {
    return state;
  },
  set(next: State) {
    if (next.mapId === state.mapId && next.stage === state.stage) return;
    state = next;
    listeners.forEach((l) => l());
  },
  clear() {
    if (state.mapId === null && state.stage === null) return;
    state = { mapId: null, stage: null };
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
