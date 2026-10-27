"use client";

import { useState, useTransition } from "react";
import { joinChallenge, leaveChallenge } from "@/lib/challenges/actions";

/**
 * I'M IN for a man who isn't in (including after NOT FOR ME or leaving);
 * LEAVE CHALLENGE for one who is. Leaving asks what happens to his
 * missions from today on: removed, or kept as regular missions.
 */
export function ChallengeMembership({ challengeId, joined }: { challengeId: string; joined: boolean }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) setAsking(false);
      else setError(res.error);
    });
  };

  const small =
    "h-8 px-3 rounded-md text-[10px] font-heading tracking-widest disabled:opacity-40";

  return (
    <div className="pt-2 space-y-2">
      {!joined ? (
        <button
          type="button"
          onClick={() => run(() => joinChallenge(challengeId))}
          disabled={pending}
          className={`${small} bg-[color:var(--color-primary)] text-white`}
        >
          {pending ? "ONE MOMENT…" : "I'M IN"}
        </button>
      ) : !asking ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className={`${small} border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]`}
        >
          LEAVE CHALLENGE
        </button>
      ) : (
        <div className="p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] space-y-2" role="group" aria-label="Leave the challenge">
          <p className="text-sm">What should happen to your challenge missions from today on?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run(() => leaveChallenge(challengeId, false))}
              disabled={pending}
              className={`${small} bg-[color:var(--color-danger)] text-white`}
            >
              REMOVE MY UPCOMING CHALLENGE MISSIONS
            </button>
            <button
              type="button"
              onClick={() => run(() => leaveChallenge(challengeId, true))}
              disabled={pending}
              className={`${small} border border-[color:var(--color-border)]`}
            >
              KEEP THEM AS REGULAR MISSIONS
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={pending}
              className={`${small} text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]`}
            >
              STAY IN
            </button>
          </div>
        </div>
      )}
      {error ? <p className="text-[11px] text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
