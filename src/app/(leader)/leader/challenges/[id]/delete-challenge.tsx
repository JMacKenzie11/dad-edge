"use client";

import { useRef } from "react";
import { useConfirm } from "@/components/ui/use-confirm";
import { deleteChallenge } from "../actions";

export function DeleteChallenge({ challengeId, name }: { challengeId: string; name: string }) {
  const [dialog, confirm] = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={deleteChallenge}>
      {dialog}
      <input type="hidden" name="challenge_id" value={challengeId} />
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({
            title: `Delete ${name}?`,
            body: "Everyone's upcoming challenge missions are removed. This can't be undone.",
            confirmLabel: "DELETE",
            cancelLabel: "Keep it",
            destructive: true,
          });
          if (ok) formRef.current?.requestSubmit();
        }}
        className="h-9 px-3 rounded-md bg-[color:var(--color-danger)] text-white text-[10px] font-heading tracking-widest"
      >
        DELETE CHALLENGE
      </button>
    </form>
  );
}
