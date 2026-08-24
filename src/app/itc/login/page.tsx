import Image from "next/image";
import Link from "next/link";
import { itcLogin } from "./actions";

const ERROR_COPY: Record<string, string> = {
  bad_password: "That password isn't right.",
  invalid: "Enter a valid email and password.",
  disabled: "ITC access is currently disabled.",
  session_missing: "Your session expired or the cookie didn't come through. Sign in again.",
  participant_missing: "We couldn't find your participant record. Sign in to recreate it.",
  migrated:
    "Your account has been upgraded. Sign in with your password on the main login page. If you haven't set one yet, check your email for your activation link.",
};

export default async function ItcLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error ? ERROR_COPY[params.error] : null;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-8">
      <Image
        src="/brand/logo-tagline-white.png"
        alt="THE DAD EDGE - Live Legendary"
        width={320}
        height={90}
        priority
      />
      <div className="w-full max-w-sm bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Dad Edge Goal Clarifier</h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Boardroom preview. Sign in to build your map.
          </p>
        </div>

        <form action={itcLogin} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
              Email
            </span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
              Password
            </span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
            />
          </label>

          {errorMessage ? (
            <p
              className={
                params.error === "migrated"
                  ? "text-sm text-[color:var(--color-primary)]"
                  : "text-sm text-[color:var(--color-danger)]"
              }
            >
              {errorMessage}
            </p>
          ) : null}

          {params.error === "migrated" ? (
            <Link
              href="/login"
              className="block w-full rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold text-center text-white"
            >
              Go to the main login
            </Link>
          ) : (
            <button
              type="submit"
              className="w-full rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold"
            >
              Enter
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
