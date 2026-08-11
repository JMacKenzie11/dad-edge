"use client";

import { useRef, useState, useTransition } from "react";
import type { ItcMessage } from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";
import {
  advanceMapStage,
  removeBehavior,
  sendCoachMessage,
  toggleBehaviorSelected,
} from "../actions";

type Behavior = {
  id: string;
  text: string;
  source: "user" | "suggested";
  selected: boolean;
};

const MAX_SELECTED = 5;

export function Conversation({
  mapId,
  stage,
  messages,
  behaviors,
}: {
  mapId: string;
  stage: ItcStage;
  messages: ItcMessage[];
  behaviors: Behavior[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const displayMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  function handleSend(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await sendCoachMessage(fd);
      if (!res.ok) setError(res.reason ?? "Something went wrong.");
      if (textRef.current) textRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <ol className="flex-1 overflow-y-auto space-y-3 pr-1">
        {displayMessages.length === 0 ? (
          <li className="text-sm italic text-[color:var(--color-muted)]">
            Say hello, or tell me what's on your mind about this pillar.
          </li>
        ) : null}
        {displayMessages.map((m) => (
          <li
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-2 text-sm"
                : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm whitespace-pre-wrap"
            }
          >
            {m.content}
          </li>
        ))}
        {pending ? (
          <li className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm">
            <TypingDots />
          </li>
        ) : null}
      </ol>

      <form
        action={handleSend}
        className="mt-3 flex items-end gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <input type="hidden" name="map_id" value={mapId} />
        <textarea
          ref={textRef}
          name="text"
          required
          rows={2}
          maxLength={4000}
          placeholder="Type… (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (pending) return;
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "…" : "Send"}
        </button>
      </form>

      {stage === "behaviors" ? (
        <BehaviorPanel
          mapId={mapId}
          behaviors={behaviors}
          onError={setError}
        />
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[color:var(--color-muted)]"
      aria-label="Coach is thinking"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
    </span>
  );
}

function BehaviorPanel({
  mapId,
  behaviors,
  onError,
}: {
  mapId: string;
  behaviors: Behavior[];
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3 space-y-3 border-t border-[color:var(--color-border)] pt-3">
      {behaviors.length > 0 ? (
        <BehaviorList
          mapId={mapId}
          behaviors={behaviors}
          onError={onError}
          startTransition={startTransition}
        />
      ) : (
        <p className="text-xs italic text-[color:var(--color-muted)]/70">
          The coach captures behaviors as you name them. Chat below.
        </p>
      )}

      <ContinueBar
        mapId={mapId}
        selectedCount={behaviors.filter((b) => b.selected).length}
        pending={pending}
        onError={onError}
        startTransition={startTransition}
      />
    </div>
  );
}

function BehaviorList({
  mapId,
  behaviors,
  onError,
  startTransition,
}: {
  mapId: string;
  behaviors: Behavior[];
  onError: (msg: string | null) => void;
  startTransition: React.TransitionStartFunction;
}) {
  const selected = behaviors.filter((b) => b.selected);
  const parked = behaviors.filter((b) => !b.selected);
  const overCap = selected.length > MAX_SELECTED;

  return (
    <div className="space-y-3">
      <section className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
          <span>
            Selected ({selected.length}/{MAX_SELECTED})
          </span>
          {overCap ? (
            <span className="text-[color:var(--color-danger)] normal-case">
              Prune to {MAX_SELECTED} to continue.
            </span>
          ) : null}
        </div>
        {selected.length === 0 ? (
          <p className="text-xs italic text-[color:var(--color-muted)]/70">
            None yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {selected.map((b) => (
              <BehaviorRow
                key={b.id}
                mapId={mapId}
                behavior={b}
                onError={onError}
                startTransition={startTransition}
              />
            ))}
          </ul>
        )}
      </section>

      {parked.length > 0 ? (
        <section className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
            Parked ({parked.length})
          </div>
          <ul className="space-y-1.5">
            {parked.map((b) => (
              <BehaviorRow
                key={b.id}
                mapId={mapId}
                behavior={b}
                onError={onError}
                startTransition={startTransition}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BehaviorRow({
  mapId,
  behavior,
  onError,
  startTransition,
}: {
  mapId: string;
  behavior: Behavior;
  onError: (msg: string | null) => void;
  startTransition: React.TransitionStartFunction;
}) {
  const parked = !behavior.selected;
  return (
    <li
      className={
        "flex items-center gap-2 text-xs " +
        (parked
          ? "text-[color:var(--color-muted)]/60"
          : "text-[color:var(--color-muted)]")
      }
    >
      <span
        className={
          "w-1.5 h-1.5 rounded-full " +
          (parked ? "bg-[color:var(--color-muted)]/40" : "bg-[color:var(--color-primary)]")
        }
      />
      <span className={"flex-1 truncate " + (parked ? "line-through" : "")}>
        {behavior.text}
      </span>
      <form
        action={(fd) => {
          onError(null);
          startTransition(async () => {
            const res = await toggleBehaviorSelected(fd);
            if (!res.ok) onError(res.reason ?? "Could not update.");
          });
        }}
      >
        <input type="hidden" name="map_id" value={mapId} />
        <input type="hidden" name="behavior_id" value={behavior.id} />
        <input type="hidden" name="selected" value={parked ? "true" : "false"} />
        <button
          type="submit"
          className="text-[color:var(--color-muted)] hover:text-white"
          title={parked ? "Bring back" : "Park (keep for context)"}
        >
          {parked ? "Restore" : "Park"}
        </button>
      </form>
      <form
        action={(fd) => {
          onError(null);
          startTransition(async () => {
            const res = await removeBehavior(fd);
            if (!res.ok) onError(res.reason ?? "Could not remove.");
          });
        }}
      >
        <input type="hidden" name="map_id" value={mapId} />
        <input type="hidden" name="behavior_id" value={behavior.id} />
        <button
          type="submit"
          className="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)]"
          title="Delete"
        >
          ×
        </button>
      </form>
    </li>
  );
}

function ContinueBar({
  mapId,
  selectedCount,
  pending,
  onError,
  startTransition,
}: {
  mapId: string;
  selectedCount: number;
  pending: boolean;
  onError: (msg: string | null) => void;
  startTransition: React.TransitionStartFunction;
}) {
  const canContinue = selectedCount >= 1 && selectedCount <= MAX_SELECTED;
  return (
    <form
      action={(fd) => {
        onError(null);
        fd.set("to", "worries");
        startTransition(async () => {
          const res = await advanceMapStage(fd);
          if (!res.ok) onError(res.reason ?? "Not ready to advance yet.");
        });
      }}
    >
      <input type="hidden" name="map_id" value={mapId} />
      <button
        type="submit"
        disabled={pending || !canContinue}
        className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        I'm done adding behaviors — continue
      </button>
    </form>
  );
}
