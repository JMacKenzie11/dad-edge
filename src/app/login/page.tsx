import Image from "next/image";
import Link from "next/link";
import { signIn, signUp, requestPasswordReset } from "./actions";

type Mode = "signin" | "signup" | "forgot";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    error?: string;
    next?: string;
    sent?: string;
    reset?: string;
  }>;
}) {
  const params = await searchParams;
  const mode: Mode =
    params.mode === "signup" ? "signup" : params.mode === "forgot" ? "forgot" : "signin";
  const next = params.next ?? "/today";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-8">
      <Image
        src="/brand/logo-tagline-white.png"
        alt="THE DAD EDGE — Live Legendary"
        width={320}
        height={90}
        priority
      />
      <div className="w-full max-w-sm bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-4">
        {mode === "signin" ? (
          <SignInForm error={params.error} next={next} sent={params.sent} reset={params.reset} />
        ) : mode === "signup" ? (
          <SignUpForm error={params.error} next={next} sent={params.sent} />
        ) : (
          <ForgotForm error={params.error} sent={params.reset} />
        )}
      </div>
    </main>
  );
}

function SignInForm({
  error,
  next,
  sent,
  reset,
}: {
  error?: string;
  next: string;
  sent?: string;
  reset?: string;
}) {
  return (
    <>
      <div>
        <h1 className="font-heading text-2xl">Sign in</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          Email and password.
        </p>
      </div>
      {sent ? (
        <p className="text-xs text-[color:var(--color-primary)]">
          Check your email to confirm your account.
        </p>
      ) : null}
      {reset ? (
        <p className="text-xs text-[color:var(--color-primary)]">
          Password reset link sent. Check your email.
        </p>
      ) : null}
      <form action={signIn} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="EMAIL" name="email" type="email" required autoFocus />
        <Field label="PASSWORD" name="password" type="password" required minLength={8} />
        <button
          type="submit"
          className="w-full h-11 rounded-md font-heading text-sm bg-[color:var(--color-primary)] text-white tracking-wide"
        >
          SIGN IN
        </button>
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      </form>
      <div className="flex items-center justify-between text-xs">
        <Link
          href={`/login?mode=signup${next !== "/today" ? `&next=${encodeURIComponent(next)}` : ""}`}
          className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
        >
          Create account
        </Link>
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

function SignUpForm({ error, next, sent }: { error?: string; next: string; sent?: string }) {
  return (
    <>
      <div>
        <h1 className="font-heading text-2xl">Create account</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          Sign up with email and password.
        </p>
      </div>
      {sent ? (
        <p className="text-xs text-[color:var(--color-primary)]">
          Check your email to confirm.
        </p>
      ) : null}
      <form action={signUp} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="EMAIL" name="email" type="email" required autoFocus />
        <Field
          label="PASSWORD"
          name="password"
          type="password"
          required
          minLength={8}
          hint="At least 8 characters."
        />
        <Field label="CONFIRM PASSWORD" name="confirm" type="password" required minLength={8} />
        <button
          type="submit"
          className="w-full h-11 rounded-md font-heading text-sm bg-[color:var(--color-primary)] text-white tracking-wide"
        >
          CREATE ACCOUNT
        </button>
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      </form>
      <Link
        href="/login"
        className="block text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
      >
        ← Back to sign in
      </Link>
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
          If an account exists, a reset link has been sent.
        </p>
      ) : null}
      <form action={requestPasswordReset} className="space-y-3">
        <Field label="EMAIL" name="email" type="email" required autoFocus />
        <button
          type="submit"
          className="w-full h-11 rounded-md font-heading text-sm bg-[color:var(--color-primary)] text-white tracking-wide"
        >
          SEND RESET LINK
        </button>
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      </form>
      <Link
        href="/login"
        className="block text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
      >
        ← Back to sign in
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
        <span className="text-[10px] text-[color:var(--color-text-muted)] mt-1 block">{hint}</span>
      ) : null}
    </label>
  );
}
