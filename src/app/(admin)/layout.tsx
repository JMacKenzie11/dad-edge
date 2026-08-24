import Link from "next/link";
import Image from "next/image";
import { requirePlatformAdmin } from "@/lib/admin";
import { AdminNav } from "@/components/shell/admin-nav";
import { HelpWidget } from "@/components/help/help-widget";
import { CurrentHelpViewProvider } from "@/components/help/current-view-context";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <CurrentHelpViewProvider>
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-[color:var(--color-bg)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <div className="mx-auto max-w-6xl h-14 px-4 flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-2">
            <Image src="/brand/mark-white.png" alt="" width={24} height={24} />
            <span className="font-heading text-sm tracking-widest">PLATFORM ADMIN</span>
          </Link>
          <div className="flex items-center gap-4 text-xs">
            <Link
              href="/today"
              className="font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
            >
              MEMBER VIEW
            </Link>
            <span className="text-[color:var(--color-text-muted)]">{user.email}</span>
            <form action="/logout" method="post">
              <button
                type="submit"
                className="font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
              >
                SIGN OUT
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <AdminNav scope="admin" />
        <main>{children}</main>
      </div>
      <HelpWidget role="admin" />
    </div>
    </CurrentHelpViewProvider>
  );
}
