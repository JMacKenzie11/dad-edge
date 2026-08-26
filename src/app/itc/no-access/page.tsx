import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Friendly deny page for a signed-in user without users.itc_access.
 * Per auth-phase spec Section 7: a member of a non-ITC community
 * (now: a user without the access flag) hitting /itc gets a plain,
 * friendly explanation, not a 404.
 *
 * If the user isn't signed in at all, bounce to /login.
 */
export default async function ItcNoAccessPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/itc");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-8">
      <Image
        src="/brand/logo-tagline-white.png"
        alt="THE DAD EDGE - Live Legendary"
        width={320}
        height={90}
        priority
      />
      <div className="w-full max-w-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-4">
        <div>
          <h1 className="font-heading text-2xl">Not for you yet</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            The improvement map coaching tool isn't part of your current
            group. It's a smaller cohort track running alongside the main app.
          </p>
        </div>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          If you think you should have access, ask your admin. Otherwise
          head back to your usual work below.
        </p>
        <div className="flex gap-2">
          <Link
            href="/today"
            className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest flex items-center"
          >
            BACK TO TODAY
          </Link>
          <Link
            href="/me"
            className="h-10 px-4 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:text-white font-heading text-xs tracking-widest flex items-center"
          >
            MY ACCOUNT
          </Link>
        </div>
      </div>
    </main>
  );
}
