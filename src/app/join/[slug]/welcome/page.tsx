import Image from "next/image";
import Link from "next/link";

/** Where Stripe Checkout sends him after paying. The webhook does the
 *  setup and sends the email; this page tells him to look for it. */
export default function JoinWelcomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-8">
      <Image src="/brand/logo-tagline-white.png" alt="THE DAD EDGE - Live Legendary" width={320} height={90} priority />
      <div className="w-full max-w-sm bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-3">
        <h1 className="font-heading text-2xl">You&apos;re in</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Check your email. New members get a link to set a password, and it can take a minute to arrive.
        </p>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Already have an account? Sign in as usual and you&apos;ll find the community there.
        </p>
        <Link href="/login" className="block text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]">
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
