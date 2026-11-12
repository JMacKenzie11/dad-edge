"use client";

import { useActionState } from "react";
import { allowApp, declineApp, type ConsentResult } from "./actions";

const btn = "h-11 flex-1 rounded-md font-heading text-sm tracking-widest disabled:opacity-60";

export function ConsentForm({ authorizationId, canAllow }: { authorizationId: string; canAllow: boolean }) {
  const [allowState, allow, allowing] = useActionState<ConsentResult, FormData>(allowApp, {});
  const [declineState, decline, declining] = useActionState<ConsentResult, FormData>(declineApp, {});
  const error = allowState.error ?? declineState.error;
  const busy = allowing || declining;
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <form action={decline} className="flex-1 flex">
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button type="submit" disabled={busy} className={`${btn} border border-[color:var(--color-border)]`}>
            {declining ? "DECLINING…" : "DECLINE"}
          </button>
        </form>
        {canAllow ? (
          <form action={allow} className="flex-1 flex">
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <button type="submit" disabled={busy} className={`${btn} bg-[color:var(--color-accent)] text-[color:var(--color-bg)]`}>
              {allowing ? "CONNECTING…" : "ALLOW"}
            </button>
          </form>
        ) : null}
      </div>
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
