/**
 * A tab left open across a deploy runs the old version's code. Its next
 * server response can come from the new version, and the old code can't
 * render it, so the page crashes (docs/failure-modes.md FM-14). A reload
 * fixes that. A real bug crashes again after the reload, so a tab
 * reloads itself at most once per window and then shows the error.
 */

export const RELOAD_WINDOW_MS = 30_000;
export const RELOAD_KEY = "brave-man:auto-reloaded-at";

export function shouldAutoReload(lastReloadAt: string | null, now: number): boolean {
  const last = Number(lastReloadAt);
  if (!lastReloadAt || !Number.isFinite(last)) return true;
  return now - last > RELOAD_WINDOW_MS;
}

/** Reloads the tab if it hasn't just done so. Returns whether it did. */
export function reloadOnce(): boolean {
  try {
    if (!shouldAutoReload(sessionStorage.getItem(RELOAD_KEY), Date.now())) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: without a record of the last reload we can't
    // rule out a loop, so show the error instead.
    return false;
  }
  window.location.reload();
  return true;
}
