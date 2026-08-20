"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

type ConfirmConfig = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * Small hook: `[dialog, confirm] = useConfirm()`.
 *
 * Render `{dialog}` once at the top of your component's return.
 * Call `await confirm({ title, body, ... })` at any callsite where
 * you'd otherwise call `window.confirm(msg)`. Returns `true` if the
 * user confirmed, `false` if they cancelled.
 *
 * Uses the styled ConfirmDialog so the confirmation is themed +
 * keyboard-accessible + screen-reader-labeled, replacing the browser
 * OS chrome confirm.
 */
export function useConfirm(): [
  React.ReactNode,
  (cfg: ConfirmConfig) => Promise<boolean>,
] {
  const [pending, setPending] = useState<
    (ConfirmConfig & { resolve: (value: boolean) => void }) | null
  >(null);

  const confirm = useCallback(
    (cfg: ConfirmConfig) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...cfg, resolve });
      }),
    [],
  );

  const dialog = pending ? (
    <ConfirmDialog
      open
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      destructive={pending.destructive}
      onConfirm={() => {
        pending.resolve(true);
        setPending(null);
      }}
      onCancel={() => {
        pending.resolve(false);
        setPending(null);
      }}
    />
  ) : null;

  return [dialog, confirm];
}
