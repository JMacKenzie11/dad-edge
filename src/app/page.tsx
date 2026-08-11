import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-10">
      <Image
        src="/brand/logo-tagline-white.png"
        alt="THE DAD EDGE — Live Legendary"
        width={420}
        height={120}
        priority
      />
      <div className="text-center max-w-md space-y-4">
        <h1 className="font-heading text-4xl md:text-5xl">Brave Man Operating System</h1>
        <p className="text-[color:var(--color-text-muted)]">
          Log the day. Set the mission. Report back.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="px-5 py-3 font-heading text-sm rounded-md bg-[color:var(--color-primary)] text-white"
        >
          Sign in
        </Link>
        <Link
          href="/design"
          className="px-5 py-3 font-heading text-sm rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)]"
        >
          Design system
        </Link>
      </div>
    </main>
  );
}
