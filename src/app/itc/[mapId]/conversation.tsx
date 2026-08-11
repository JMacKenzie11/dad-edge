"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcMessage } from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";
import { GOAL_STEM } from "@/lib/itc/stage";
import {
  acceptBehavior,
  acceptGoal,
  advanceMapStage,
  removeBehavior,
  sendCoachMessage,
} from "../actions";

type Behavior = { id: string; text: string; source: "user" | "suggested" };

export function Conversation({
  mapId,
  stage,
  messages,
  behaviors,
  improvementGoal,
}: {
  mapId: string;
  stage: ItcStage;
  messages: ItcMessage[];
  behaviors: Behavior[];
  improvementGoal: string | null;
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

      {stage === "goal" ? (
        <GoalLockPanel
          mapId={mapId}
          improvementGoal={improvementGoal}
          onError={setError}
        />
      ) : null}

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

function GoalLockPanel({
  mapId,
  improvementGoal,
  onError,
}: {
  mapId: string;
  improvementGoal: string | null;
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(improvementGoal ?? GOAL_STEM + " ");
  const hasGoal = Boolean(improvementGoal);
  // When the coach saves/updates the goal, sync the textarea so the user
  // doesn't have to retype what the coach just proposed.
  useEffect(() => {
    if (improvementGoal) setText(improvementGoal);
  }, [improvementGoal]);
  return (
    <form
      action={(fd) => {
        onError(null);
        startTransition(async () => {
          const res = await acceptGoal(fd);
          if (!res.ok) onError(res.reason ?? "Could not lock goal.");
        });
      }}
      className="mt-3 space-y-2 border-t border-[color:var(--color-border)] pt-3"
    >
      <input type="hidden" name="map_id" value={mapId} />
      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
          {hasGoal ? "Update improvement goal" : "Lock improvement goal"}
        </span>
        <textarea
          name="text"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[color:var(--color-primary)]/80 px-3 py-1.5 text-xs font-semibold"
      >
        {pending ? "Locking…" : "Lock goal & continue"}
      </button>
    </form>
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
      <form
        action={(fd) => {
          onError(null);
          startTransition(async () => {
            const res = await acceptBehavior(fd);
            if (!res.ok) onError(res.reason ?? "Could not add behavior.");
            const input = document.getElementById(
              "behavior-input",
            ) as HTMLInputElement | null;
            if (input) input.value = "";
          });
        }}
        className="flex items-end gap-2"
      >
        <input type="hidden" name="map_id" value={mapId} />
        <label className="flex-1 space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
            Add a behavior
          </span>
          <input
            id="behavior-input"
            name="text"
            required
            maxLength={500}
            placeholder="What do you do (or fail to do) that works against the goal?"
            className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--color-primary)]/80 px-3 py-2 text-xs font-semibold"
        >
          Add
        </button>
      </form>

      {behaviors.length > 0 ? (
        <ul className="space-y-1.5">
          {behaviors.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-2 text-xs text-[color:var(--color-muted)]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-primary)]" />
              <span className="flex-1 truncate">{b.text}</span>
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
                <input type="hidden" name="behavior_id" value={b.id} />
                <button
                  type="submit"
                  className="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)]"
                  title="Remove"
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

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
          disabled={pending || behaviors.length === 0}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          I'm done adding behaviors — continue
        </button>
      </form>
    </div>
  );
}
