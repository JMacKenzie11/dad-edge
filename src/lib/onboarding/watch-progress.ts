/**
 * How far he has actually watched an onboarding video. `reached` only
 * moves forward while the video plays on from the furthest point he has
 * seen, so dragging the slider to the end doesn't count. `at` is where
 * the player is now, kept so he can resume there.
 *
 * Vimeo reports the position about four times a second, so normal
 * playback (even at 2x) moves well under MAX_PLAY_STEP between reports.
 */
export type WatchState = { reached: number; at: number };

export const UNLOCK_SHARE = 0.9;
export const MAX_PLAY_STEP = 3;

export const START: WatchState = { reached: 0, at: 0 };

export function advance(state: WatchState, seconds: number): WatchState {
  if (!Number.isFinite(seconds) || seconds < 0) return state;
  const step = seconds - state.at;
  const playingOn = step > 0 && step <= MAX_PLAY_STEP && state.at <= state.reached + MAX_PLAY_STEP;
  return { reached: playingOn ? Math.max(state.reached, seconds) : state.reached, at: seconds };
}

export function isUnlocked(state: WatchState, durationSeconds: number): boolean {
  return durationSeconds > 0 && state.reached >= durationSeconds * UNLOCK_SHARE;
}

/** Where to pick up: his last spot, unless he was right at the start or the end. */
export function resumeAt(state: WatchState, durationSeconds: number): number {
  if (state.at < 5) return 0;
  if (durationSeconds > 0 && state.at > durationSeconds - 10) return 0;
  return state.at;
}

/** Parse what we saved in the browser; anything odd starts him fresh. */
export function parseSaved(raw: string | null): WatchState {
  if (!raw) return START;
  try {
    const v = JSON.parse(raw) as Partial<WatchState>;
    const reached = Number(v.reached);
    const at = Number(v.at);
    if (!Number.isFinite(reached) || !Number.isFinite(at) || reached < 0 || at < 0) return START;
    return { reached, at };
  } catch {
    return START;
  }
}
