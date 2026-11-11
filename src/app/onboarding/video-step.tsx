"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { advance, isUnlocked, parseSaved, resumeAt, type WatchState } from "@/lib/onboarding/watch-progress";
import { finishOnboardingVideo } from "./actions";

/**
 * One onboarding video with its "I've watched it" button. The button
 * unlocks once he has played through 90% of the video (dragging the
 * slider doesn't count), or straight away if he finished it before.
 * His spot is kept in this browser so he picks up where he left off.
 *
 * If the Vimeo player can't load or breaks, the button unlocks rather
 * than trapping him in the wizard.
 */
const PLAYER_TIMEOUT_MS = 20_000;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function storageKey(lessonId: string) {
  return `bmos:onboarding-video:${lessonId}`;
}

function readSaved(lessonId: string): WatchState {
  try {
    return parseSaved(window.localStorage.getItem(storageKey(lessonId)));
  } catch {
    return parseSaved(null);
  }
}

function save(lessonId: string, state: WatchState) {
  try {
    window.localStorage.setItem(storageKey(lessonId), JSON.stringify(state));
  } catch {
    // Private window or blocked storage: he just won't resume mid-video.
  }
}

export function VideoStep({
  step,
  lessonId,
  embedUrl,
  title,
  durationSeconds,
  alreadyDone,
  buttonLabel,
  error,
}: {
  step: number;
  lessonId: string;
  embedUrl: string;
  title: string;
  durationSeconds: number;
  alreadyDone: boolean;
  buttonLabel: string;
  error?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [watch, setWatch] = useState<WatchState>({ reached: 0, at: 0 });
  const [duration, setDuration] = useState(durationSeconds);
  const [playerFailed, setPlayerFailed] = useState(false);
  const unlocked = alreadyDone || playerFailed || isUnlocked(watch, duration);

  useEffect(() => {
    if (!frame.current) return;
    let cancelled = false;
    let lastSaved = 0;
    let state = readSaved(lessonId);
    setWatch(state);
    let destroy: (() => void) | undefined;

    const timeout = window.setTimeout(() => {
      if (!cancelled) setPlayerFailed(true);
    }, PLAYER_TIMEOUT_MS);

    import("@vimeo/player")
      .then(({ default: Player }) => {
        if (cancelled || !frame.current) return;
        const player = new Player(frame.current);
        destroy = () => void player.destroy().catch(() => {});
        player
          .ready()
          .then(async () => {
            window.clearTimeout(timeout);
            const d = await player.getDuration().catch(() => 0);
            if (d > 0) setDuration(d);
            const from = resumeAt(state, d || durationSeconds);
            if (from > 0) await player.setCurrentTime(from).catch(() => {});
          })
          .catch(() => {
            window.clearTimeout(timeout);
            if (!cancelled) setPlayerFailed(true);
          });
        player.on("timeupdate", ({ seconds }: { seconds: number }) => {
          state = advance(state, seconds);
          setWatch(state);
          if (Math.abs(seconds - lastSaved) >= 5) {
            lastSaved = seconds;
            save(lessonId, state);
          }
        });
        // A player that breaks mid-video (network, Vimeo outage) unlocks
        // the button too: better a skipped video than a man stuck here.
        player.on("error", () => {
          if (!cancelled) setPlayerFailed(true);
        });
        player.on("pause", () => save(lessonId, state));
        player.on("ended", () => save(lessonId, { reached: state.reached, at: 0 }));
      })
      .catch(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setPlayerFailed(true);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      save(lessonId, state);
      destroy?.();
    };
  }, [lessonId, durationSeconds]);

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black border border-[color:var(--color-border)]">
        <iframe
          ref={frame}
          src={embedUrl}
          title={title}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>

      <form action={finishOnboardingVideo} className="space-y-2">
        <input type="hidden" name="step" value={step} />
        <SubmitButton label={buttonLabel} pendingLabel="Saving…" disabled={!unlocked} className="w-full h-12" />
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
        <p className="text-xs text-center text-[color:var(--color-text-muted)]" aria-live="polite">
          {alreadyDone
            ? "You've watched this one before."
            : playerFailed
              ? "The video didn't load. You can watch it any time in Resources."
              : unlocked
                ? "Done. Tap the button to keep going."
                : `The button unlocks near the end. You've watched ${clock(watch.reached)} of ${clock(duration)}.`}
        </p>
      </form>
    </div>
  );
}
