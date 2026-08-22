import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updatePassword } from "@/app/login/actions";

export const dynamic = "force-dynamic";

/**
 * Set-password page. Destination for the invite link sent by admin
 * Send Invite (Checkpoint C of the auth-phase spec). The user has
 * clicked their emailed activation link, which lands them on
 * /auth/callback (which exchanges the token for a session) with
 * ?next=/set-password, so they arrive here already-authenticated
 * but with no usable password on the account.
 *
 * The page is intentionally a sibling of /reset-password rather
 * than a redirect to it — the copy and framing are different. This
 * is activation, not recovery. Same underlying updatePassword
 * action; different context around it.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If no session, the invite link expired or was already used. Bounce
  // to sign-in with a plain message rather than showing a broken form.
  if (!user) {
    redirect("/login?error=Activation%20link%20expired%20or%20already%20used.");
  }

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
          <h1 className="font-heading text-2xl">Set your password</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            One-time setup. You'll sign in with your email and this password from now on.
          </p>
        </div>
        <form action={updatePassword} className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              PASSWORD
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
          <button
            type="submit"
            className="w-full h-11 rounded-md font-heading text-sm bg-[color:var(--color-primary)] text-white tracking-wide"
          >
            SET PASSWORD AND SIGN IN
          </button>
          {params.error ? (
            <p className="text-xs text-[color:var(--color-danger)]">{params.error}</p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
