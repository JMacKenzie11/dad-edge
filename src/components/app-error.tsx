"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { reloadOnce } from "@/lib/errors/reload-once";

/**
 * What a member sees when a page crashes, in place of Next's bare
 * "Application error" screen. Most crashes in production are a tab left
 * open across a deploy (FM-14), which a reload fixes, so it reloads once
 * by itself first.
 */
export function AppError({ error }: { error: Error & { digest?: string } }) {
  const [reloading, setReloading] = useState(true);

  useEffect(() => {
    console.error(error);
    if (!reloadOnce()) setReloading(false);
  }, [error]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-6 text-center">
      <Image src="/brand/mark-white.png" alt="" width={56} height={56} className="opacity-70" />
      {reloading ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">Reloading the page.</p>
      ) : (
        <>
          <h1 className="font-heading text-3xl">This page didn&apos;t load.</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] max-w-sm">
            Reload it. If it fails again, tell your community leader.
          </p>
          <Button onClick={() => window.location.reload()}>RELOAD</Button>
          {error.digest ? (
            <p className="text-xs text-[color:var(--color-text-muted)]">Error code {error.digest}</p>
          ) : null}
        </>
      )}
    </main>
  );
}
