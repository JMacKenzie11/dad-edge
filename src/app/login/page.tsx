import Image from "next/image";
import Link from "next/link";
import { requestPasswordReset, signIn } from "./actions";
import { SubmitButton } from "./submit-button";

type Mode = "signin" | "forgot";

/**
 * Public login screen. Per the auth-phase spec (2026-08-22), public
 * sign-up is off — new accounts happen only through the admin panel
 * followed by an explicit Send Invite. Two modes only:
 *
 *   signin  — email + password (default)
 *   forgot  — password reset request
 *
 * Magic-link fallback removed 2026-08-23: Forgot password covers the
 * locked-out-of-password case, and having two "email me a link" paths
 * was just noise.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    error?: string;
    next?: string;
    reset?: string;
  }>;
}) {
  const params = await searchParams;
  const mode: Mode = params.mode === "forgot" ? "forgot" : "signin";
  const next = params.next ?? "/today";

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
        {mode === "signin" ? (
          // Reset-just-sent state: user came here after Forgot password.
          // No form — showing sign-in fields would imply they can sign
          // in right now, when actually they're waiting on an email.
          params.reset ? (
            <ResetSentPanel />
          ) : (
            <SignInForm error={params.error} next={next} />
          )
        ) : (
          <ForgotForm error={params.error} sent={params.reset} />
        )}
      </div>
    </main>
  );
}

function ResetSentPanel() {
  return (
    <>
      <div>
        <h1 className="font-heading text-2xl">Check your email</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          If that account exists, we've sent a reset link. Click it and
          you'll be able to set a new password.
        </p>
      </div>
      <p className="text-xs text-[color:var(--color-text-muted)]">
        Didn't get it? Give it a minute, then check your spam folder. Still
        nothing — the address you entered probably doesn't have an account
        on this system.
      </p>
      <Link
        href="/login"
        className="block text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
      >
        Back to sign in
      </Link>
    </>
  );
}

function SignInForm({ error, next }: { error?: string; next: string }) {
  return (
    <>
      <div>
        <h1 className="font-heading text-2xl">Sign in</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          Email and password.
        </p>
      </div>
      <form action={signIn} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="EMAIL" name="email" type="email" required autoFocus />
        <Field
          label="PASSWORD"
          name="password"
          type="password"
          required
          minLength={8}
        />
        <SubmitButton label="SIGN IN" pendingLabel="SIGNING IN…" />
        {error ? (
          <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
        ) : null}
      </form>
      <div className="flex justify-end text-xs">
        <Link
          href="/login?mode=forgot"
          className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
        >
          Forgot password?
        </Link>
      </div>
    </>
  );
}

function ForgotForm({ error, sent }: { error?: string; sent?: string }) {
  return (
    <>
      <div>
        <h1 className="font-heading text-2xl">Reset password</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          We'll email you a link.
        </p>
      </div>
      {sent ? (
        <p className="text-xs text-[color:var(--color-primary)]">
          If that account exists, we've sent a reset link. Check your email.
        </p>
      ) : null}
      <form action={requestPasswordReset} className="space-y-3">
        <Field label="EMAIL" name="email" type="email" required autoFocus />
        <SubmitButton label="SEND RESET LINK" pendingLabel="SENDING…" />
        {error ? (
          <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
        ) : null}
      </form>
      <Link
        href="/login"
        className="block text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
      >
        Back to sign in
      </Link>
    </>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoFocus,
  minLength,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
  minLength?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        autoFocus={autoFocus}
        minLength={minLength}
        className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-[color:var(--color-text)] focus:border-[color:var(--color-primary)]"
      />
      {hint ? (
        <span className="text-[10px] text-[color:var(--color-text-muted)] mt-1 block">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
