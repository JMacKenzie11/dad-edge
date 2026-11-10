"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { deleteReachOut, logReachOut } from "@/lib/coaching/actions";
import type { Followup } from "@/lib/coaching/load";

/** Log a reach-out so the other leaders know he's been contacted. */
export function ReachOut({
  communityId,
  memberId,
  followups,
  viewerId,
  viewerIsAdmin,
}: {
  communityId: string;
  memberId: string;
  followups: Followup[];
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setError(null);
    start(async () => {
      const r = await logReachOut({ communityId, memberId, note });
      if (!r.ok) return setError(r.error ?? "Couldn't save. Try again.");
      setNote("");
      router.refresh();
    });
  };

  const remove = (id: string) => {
    start(async () => {
      const r = await deleteReachOut({ id });
      if (!r.ok) return setError(r.error ?? "Couldn't remove. Try again.");
      router.refresh();
    });
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-4 space-y-3">
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">REACHED OUT</p>
      <form action={save} className="space-y-2">
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What you talked about (optional). Only leaders and admins see this."
          className="w-full p-2 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Log reach-out"}
        </Button>
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      </form>
      {followups.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">No reach-outs logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {followups.map((f) => (
            <li key={f.id} className="text-sm">
              <span className="text-xs text-[color:var(--color-text-muted)]">
                {format(new Date(f.created_at), "MMM d")} · {f.author}
              </span>
              {f.note ? <span className="block">{f.note}</span> : null}
              {f.authorId === viewerId || viewerIsAdmin ? (
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  disabled={pending}
                  className="text-[11px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)]"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
