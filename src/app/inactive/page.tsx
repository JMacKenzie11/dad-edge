import Image from "next/image";
import Link from "next/link";

export default function InactivePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-6 text-center">
      <Image src="/brand/mark-white.png" alt="" width={56} height={56} className="opacity-70" />
      <h1 className="font-heading text-3xl">Account inactive</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] max-w-sm">
        Your subscription has ended. Reach out to your community leader to reactivate.
      </p>
      <Link href="/" className="text-sm underline text-[color:var(--color-accent)]">
        Home
      </Link>
    </main>
  );
}
