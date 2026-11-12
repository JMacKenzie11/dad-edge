"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { createApiKey, type CreateKeyState } from "./actions";

export function CreateKeyForm({ communities }: { communities: { id: string; name: string }[] }) {
  const [state, action] = useActionState<CreateKeyState, FormData>(createApiKey, {});
  return (
    <div className="space-y-3">
      <form
        action={action}
        className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">NAME</span>
          <input
            name="label"
            aria-label="Key name"
            required
            maxLength={80}
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          />
        </label>
        <fieldset className="space-y-1 text-xs">
          <legend className="font-heading tracking-widest text-[color:var(--color-text-muted)]">COMMUNITIES</legend>
          <p className="text-[color:var(--color-text-muted)]">Leave them all unticked to let the key read every community.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {communities.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" name="community_ids" value={c.id} aria-label="Community this key may read" />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <SubmitButton label="MAKE KEY" pendingLabel="MAKING…" className="text-xs" />
        {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
      </form>

      {state.key ? (
        <div className="p-4 rounded-[var(--radius-card)] border border-[color:var(--color-accent)] space-y-2 text-xs">
          <p className="font-heading tracking-widest">KEY FOR {state.label?.toUpperCase()}</p>
          <code className="block break-all p-2 rounded-md bg-[color:var(--color-bg)] select-all">{state.key}</code>
          <p className="text-[color:var(--color-text-muted)]">
            Copy it now. It won&apos;t be shown again. In the other system, send it as the header
            <code> Authorization: Bearer </code>followed by the key.
          </p>
        </div>
      ) : null}
    </div>
  );
}
