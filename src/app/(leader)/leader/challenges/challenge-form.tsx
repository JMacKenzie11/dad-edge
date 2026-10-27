"use client";

import { useActionState, useState } from "react";
import { DOMAIN_PILLARS } from "@/lib/pillars";
import type { Challenge } from "@/lib/challenges/rules";
import type { ChallengeFormState } from "./actions";

const DAYS = [
  { n: 1, letter: "M", name: "Monday" },
  { n: 2, letter: "T", name: "Tuesday" },
  { n: 3, letter: "W", name: "Wednesday" },
  { n: 4, letter: "T", name: "Thursday" },
  { n: 5, letter: "F", name: "Friday" },
  { n: 6, letter: "S", name: "Saturday" },
  { n: 7, letter: "S", name: "Sunday" },
];

const input =
  "mt-1 w-full h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm disabled:opacity-50";
const label = "text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]";

/**
 * New-challenge and edit form. On an edit where someone has already
 * joined (`locked`), only the name and the mission stay editable.
 */
export function ChallengeForm({
  action,
  communityId,
  communities,
  returnTo = "leader",
  challenge,
  locked = false,
  defaultStart,
  submitLabel,
}: {
  action: (prev: ChallengeFormState, formData: FormData) => Promise<ChallengeFormState>;
  communityId?: string;
  /** The admin page picks the community in the form instead. */
  communities?: { id: string; name: string }[];
  returnTo?: "admin" | "leader";
  challenge?: Challenge;
  locked?: boolean;
  defaultStart: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [days, setDays] = useState<number[]>(challenge?.days ?? [1, 3, 5]);
  const [target, setTarget] = useState<number>(challenge?.target ?? 3);
  const shownTarget = Math.min(target, Math.max(1, days.length));

  return (
    <form action={formAction} className="space-y-4">
      {communityId ? <input type="hidden" name="community_id" value={communityId} /> : null}
      <input type="hidden" name="return_to" value={returnTo} />
      {communities ? (
        <label className="block max-w-xs">
          <span className={label}>COMMUNITY</span>
          <select name="community_id" required defaultValue={communities.length === 1 ? communities[0].id : ""} className={input}>
            <option value="" disabled>
              Pick a community
            </option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {challenge ? <input type="hidden" name="challenge_id" value={challenge.id} /> : null}
      {locked ? <input type="hidden" name="locked" value="1" /> : null}

      <label className="block">
        <span className={label}>NAME</span>
        <input name="name" required maxLength={80} defaultValue={challenge?.name} placeholder="30 Days of Movement" className={input} />
      </label>

      <label className="block">
        <span className={label}>MISSION</span>
        <input
          name="mission_description"
          required
          maxLength={280}
          defaultValue={challenge?.mission_description}
          placeholder="Walk 10 km"
          className={input}
        />
        <span className="block mt-1 text-[11px] text-[color:var(--color-text-muted)]">
          This is the mission each member gets every week. Changing it later updates everyone&rsquo;s upcoming missions.
        </span>
      </label>

      {locked ? (
        <p className="text-[11px] text-[color:var(--color-text-muted)]">
          Members have joined, so the domain, days, target and dates are locked. To change them, delete this challenge and set a new one.
        </p>
      ) : null}

      <fieldset disabled={locked} className="space-y-4">
        <label className="block max-w-xs">
          <span className={label}>DOMAIN</span>
          <select name="pillar_code" defaultValue={challenge?.pillar_code ?? "V"} className={input}>
            {DOMAIN_PILLARS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className={label}>DAYS</span>
          <div className="mt-1 flex gap-1" role="group" aria-label="Days of the week">
            {DAYS.map((d) => {
              const on = days.includes(d.n);
              return (
                <label
                  key={d.n}
                  title={d.name}
                  className={`h-9 w-9 rounded-md flex items-center justify-center text-xs font-heading cursor-pointer border ${
                    on
                      ? "bg-[color:var(--color-primary)] border-[color:var(--color-primary)] text-white"
                      : "border-[color:var(--color-border)] text-[color:var(--color-text-muted)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="days"
                    value={d.n}
                    checked={on}
                    aria-label={d.name}
                    onChange={() => setDays((cur) => (on ? cur.filter((x) => x !== d.n) : [...cur, d.n].sort((a, b) => a - b)))}
                    className="sr-only"
                  />
                  {d.letter}
                </label>
              );
            })}
          </div>
        </div>

        <label className="block max-w-xs">
          <span className={label}>TARGET</span>
          <span className="mt-1 flex items-center gap-2 text-sm">
            <select
              name="target"
              value={shownTarget}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
            >
              {Array.from({ length: Math.max(1, days.length) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-[color:var(--color-text-muted)]">of the picked days each week</span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3 max-w-md">
          <label className="block">
            <span className={label}>STARTS</span>
            <input type="date" name="starts_on" required defaultValue={challenge?.starts_on ?? defaultStart} className={input} />
          </label>
          <label className="block">
            <span className={label}>ENDS</span>
            <input type="date" name="ends_on" required defaultValue={challenge?.ends_on} className={input} />
          </label>
        </div>
      </fieldset>

      {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest disabled:opacity-40"
      >
        {pending ? "SAVING…" : submitLabel}
      </button>
    </form>
  );
}
