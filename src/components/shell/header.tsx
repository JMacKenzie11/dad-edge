import Image from "next/image";
import Link from "next/link";

export function AppHeader({
  userInitials,
  readOnly,
}: {
  userInitials: string;
  readOnly: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/95 backdrop-blur">
      {/* Blueprint texture layer — brand §9.4: shell surfaces only, low opacity */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage: "url(/brand/texture-dark.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      {/* Bottom accent hairline */}
      <div
        aria-hidden
        className="absolute bottom-0 inset-x-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-accent) 40%, transparent) 50%, transparent 100%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl h-20 md:h-24 px-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* LEFT — empty spacer (keeps center actually centered) */}
        <div />

        {/* CENTER - full brand logo */}
        <Link href="/today" className="justify-self-center" aria-label="The Dad Edge - Live Legendary">
          <Image
            src="/brand/logo-tagline-white.png"
            alt="THE DAD EDGE - Live Legendary"
            width={280}
            height={72}
            priority
            className="h-12 md:h-14 w-auto"
          />
        </Link>

        {/* RIGHT — status + user */}
        <div className="justify-self-end flex items-center gap-2 sm:gap-4 shrink-0">
          {readOnly ? (
            <span className="hidden sm:inline text-[10px] font-heading tracking-widest px-2 py-1 rounded border border-[color:var(--color-warning)] text-[color:var(--color-warning)]">
              READ-ONLY
            </span>
          ) : null}

          <Link
            href="/me"
            className="flex items-center justify-center h-10 w-10 rounded-full bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)] font-heading text-xs transition-colors"
            aria-label="Profile"
            title="Profile"
          >
            {userInitials}
          </Link>
        </div>
      </div>
    </header>
  );
}
