"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Client-side bridge for the implicit / hash auth flow. Supabase
 * sends `#access_token=...&refresh_token=...&type=recovery|invite`
 * in the URL fragment. Fragments never reach the server, so we parse
 * them here, call setSession() to establish the session, then route
 * based on `type`:
 *
 *   recovery  → /reset-password  (or whatever `next` said)
 *   invite    → /set-password
 *   magiclink → /today  (or `next`)
 *   signup    → /today  (or `next`)
 *
 * If the hash is empty or malformed, bounce to /login?error=Invalid+link.
 */
export function CallbackBridge({ nextParam }: { nextParam: string | null }) {
  const [status, setStatus] = useState<"working" | "error">("working");

  useEffect(() => {
    (async () => {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type = params.get("type"); // recovery | invite | magiclink | signup

      if (!accessToken || !refreshToken) {
        setStatus("error");
        window.location.replace("/login?error=Invalid+link");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        setStatus("error");
        window.location.replace(
          `/login?error=${encodeURIComponent(error.message)}`,
        );
        return;
      }

      const destination = destinationFor(type, nextParam);
      window.location.replace(destination);
    })();
  }, [nextParam]);

  if (status === "error") {
    return (
      <p className="text-sm text-[color:var(--color-danger)]">
        Sign-in link couldn't be verified. Redirecting…
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm text-[color:var(--color-text-muted)]">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--color-text-muted)]/40 border-t-[color:var(--color-text-muted)]" />
      <span>Signing you in…</span>
    </div>
  );
}

function destinationFor(type: string | null, nextParam: string | null): string {
  if (type === "recovery") return nextParam ?? "/reset-password";
  if (type === "invite") return nextParam ?? "/set-password";
  return nextParam ?? "/today";
}
