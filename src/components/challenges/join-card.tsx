"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { challengeDates, targetLine, type Challenge } from "@/lib/challenges/rules";
import { declineChallenge, joinChallenge } from "@/lib/challenges/actions";

/**
 * The cards keep their own copy of the list: joining refreshes the page,
 * the challenge drops out of "not answered yet", and without this the
 * card would vanish before he saw "You're in."
 */
export function ChallengeJoinCards({ items }: { items: { challenge: Challenge; inCount: number }[] }) {
  const [shown] = useState(items);
  return (
    <>
      {shown.map((j) => (
        <ChallengeJoinCard key={j.challenge.id} challenge={j.challenge} inCount={j.inCount} />
      ))}
    </>
  );
}

/**
 * One card per challenge he hasn't answered, at the top of Today and
 * Missions while it's open to join. I'M IN creates his missions for the
 * rest of the challenge; NOT FOR ME hides the card (he can still join
 * from the Challenges tab on Community).
 */
export function ChallengeJoinCard({ challenge, inCount }: { challenge: Challenge; inCount: number }) {
  const p = PILLAR_BY_CODE[challenge.pillar_code];
  const [state, setState] = useState<"open" | "joined" | "hidden">("open");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (state === "hidden") return null;

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, next: "joined" | "hidden") => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) setState(next);
      else setError(res.error);
    });
  };

  return (
    <section
      className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-2"
      style={{ borderLeft: `3px solid ${p.colorVar}` }}
      aria-label={`Challenge: ${challenge.name}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-heading tracking-widest" style={{ color: p.colorVar }}>
          CHALLENGE · {p.label.toUpperCase()}
        </p>
        <p className="text-[11px] text-[color:var(--color-text-muted)]">{challengeDates(challenge)}</p>
      </div>
      <h2 className="font-heading text-lg leading-tight">{challenge.name}</h2>
      <p className="text-sm">
        {challenge.mission_description}
        <span className="text-[color:var(--color-text-muted)]"> · {targetLine(challenge)}</span>
      </p>
      {state === "joined" ? (
        <p className="text-sm text-[color:var(--color-success)]">
          You&rsquo;re in. Your challenge missions are on your{" "}
          <Link href="/missions" className="underline">
            Missions
          </Link>{" "}
          page.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-[color:var(--color-text-muted)]">
            {inCount === 0 ? "No one has joined yet." : `${inCount} ${inCount === 1 ? "brother is" : "brothers are"} in.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => act(() => declineChallenge(challenge.id), "hidden")}
              disabled={pending}
              className="h-9 px-3 text-[11px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] disabled:opacity-40"
            >
              NOT FOR ME
            </button>
            <button
              type="button"
              onClick={() => act(() => joinChallenge(challenge.id), "joined")}
              disabled={pending}
              className="h-9 px-4 rounded-md bg-[color:var(--color-primary)] text-white text-xs font-heading tracking-widest disabled:opacity-40"
            >
              {pending ? "ONE MOMENT…" : "I'M IN"}
            </button>
          </div>
        </div>
      )}
      {error ? <p className="text-[11px] text-[color:var(--color-danger)]">{error}</p> : null}
    </section>
  );
}
