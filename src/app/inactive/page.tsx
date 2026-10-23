import Image from "next/image";

/**
 * Where a man lands when his access has ended. He's still signed in, and
 * every app page sends him back here, so this page has to let him sign
 * out (to sign in as someone else) rather than link anywhere in the app.
 */
export default function InactivePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-6 text-center">
      <Image src="/brand/mark-white.png" alt="" width={56} height={56} className="opacity-70" />
      <h1 className="font-heading text-3xl">Account inactive</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] max-w-sm">
        Your subscription has ended. Reach out to your community leader to reactivate.
      </p>
      <form action="/logout" method="post" className="flex flex-col items-center gap-2">
        <button
          type="submit"
          className="h-10 px-4 rounded-md border border-[color:var(--color-border)] font-heading text-xs tracking-widest hover:bg-[color:var(--color-surface)]"
        >
          SIGN OUT
        </button>
        <span className="text-xs text-[color:var(--color-text-muted)]">Then sign in with a different account.</span>
      </form>
    </main>
  );
}
