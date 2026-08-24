import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updatePassword } from "@/app/login/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reset links land here already-authenticated (Supabase exchanges the recovery
  // token for a session in /auth/callback). If no session, bounce to sign-in.
  if (!user) redirect("/login?error=Reset%20link%20expired");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-8">
      <Image
        src="/brand/logo-tagline-white.png"
        alt="THE DAD EDGE - Live Legendary"
        width={320}
        height={90}
        priority
      />
      <div className="w-full max-w-sm bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-4">
        <div>
          <h1 className="font-heading text-2xl">Set new password</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            Choose something you'll remember.
          </p>
        </div>
        <form action={updatePassword} className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              NEW PASSWORD
            </span>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoFocus
              className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] focus:border-[color:var(--color-primary)]"
            />
            <span className="text-[10px] text-[color:var(--color-text-muted)] mt-1 block">
              At least 8 characters.
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              CONFIRM PASSWORD
            </span>
            <input
              type="password"
              name="confirm"
              required
              minLength={8}
              className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] focus:border-[color:var(--color-primary)]"
            />
          </label>
          <SubmitButton
            label="UPDATE PASSWORD"
            pendingLabel="UPDATING…"
            className="w-full"
          />
          {params.error ? (
            <p className="text-xs text-[color:var(--color-danger)]">{params.error}</p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
