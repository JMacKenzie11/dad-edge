"use client";

import { useState } from "react";
import { deleteUsersBatch } from "./actions";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Bulk-delete affordance for the /admin/users list. Lives INSIDE the
 * outer users form (which also carries SEND INVITES). On click:
 *
 *   1. Reads which user_ids checkboxes in the parent form are ticked.
 *   2. If none: shows a brief inline "Select at least one" message.
 *   3. If some: opens a modal listing the count and requiring the
 *      literal word "DELETE" to be typed before enabling the confirm
 *      button.
 *   4. Confirm submits its own hidden mini-form to deleteUsersBatch
 *      with the collected user_ids + the typed confirm_text.
 *
 * We don't reuse the outer form because it drives sendInvitesBatch
 * on plain submit; a formAction override could work but a nested
 * mini-form is easier to reason about and doesn't leak the delete
 * confirm_text into an invite submission.
 */
export function BulkDeleteButton({ formSelector }: { formSelector: string }) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [emptyHint, setEmptyHint] = useState(false);

  function openDialog() {
    setEmptyHint(false);
    const form = document.querySelector(formSelector);
    if (!form) return;
    const checked = Array.from(
      form.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][name="user_ids"]:checked',
      ),
    ).map((el) => el.value);
    if (checked.length === 0) {
      setEmptyHint(true);
      window.setTimeout(() => setEmptyHint(false), 3000);
      return;
    }
    setIds(checked);
    setConfirmText("");
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="h-9 px-3 rounded-md bg-[color:var(--color-danger)] text-white font-heading text-xs tracking-widest"
      >
        DELETE SELECTED
      </button>
      {emptyHint ? (
        <span className="text-xs text-[color:var(--color-danger)] self-center">
          Select at least one user first.
        </span>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-[color:var(--color-surface)] border border-[color:var(--color-danger)]/60 rounded-[var(--radius-card)] p-5 space-y-3">
            <div>
              <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-danger)]">
                DANGER ZONE
              </p>
              <h2 className="text-lg font-semibold text-white mt-1">
                Delete {ids.length} account{ids.length === 1 ? "" : "s"}?
              </h2>
              <p className="text-sm text-[color:var(--color-text-muted)] mt-2">
                Permanent. Removes the auth users, their user rows, and
                cascades any child data with cascade-on-delete FKs. Not
                reversible. Not for cancellations — ENTITLEMENT →
                canceled handles that.
              </p>
            </div>
            <form action={deleteUsersBatch} className="space-y-3">
              {ids.map((id) => (
                <input key={id} type="hidden" name="user_ids" value={id} />
              ))}
              <label className="block">
                <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
                  TYPE DELETE TO CONFIRM
                </span>
                <input
                  name="confirm_text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  className="mt-1 w-full h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
                  placeholder="DELETE"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-10 px-4 rounded-md bg-transparent text-[color:var(--color-text-muted)] hover:text-white font-heading text-xs tracking-widest"
                >
                  CANCEL
                </button>
                <SubmitButton
                  variant="danger"
                  label="DELETE ACCOUNTS"
                  pendingLabel="DELETING…"
                  disabled={confirmText !== "DELETE"}
                />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
