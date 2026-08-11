import Image from "next/image";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.onboarding_step >= 7) redirect("/today");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-[color:var(--color-border)] flex items-center px-4">
        <div className="mx-auto max-w-md flex items-center gap-2">
          <Image src="/brand/mark-white.png" alt="" width={22} height={22} />
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            WELCOME, {(user.first_name ?? user.email).toUpperCase()}
          </p>
        </div>
      </header>
      <main className="flex-1 px-4 py-8">
        <div className="max-w-md mx-auto">{children}</div>
      </main>
    </div>
  );
}
