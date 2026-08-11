import Link from "next/link";
import Image from "next/image";
import { requireLeader } from "@/lib/admin";
import { AdminNav } from "@/components/shell/admin-nav";
import { LeaderCommunityPicker } from "./community-picker";

export const dynamic = "force-dynamic";

export default async function LeaderLayout({ children }: { children: React.ReactNode }) {
  const { user, leaderOf } = await requireLeader();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-[color:var(--color-bg)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <div className="mx-auto max-w-6xl h-14 px-4 flex items-center justify-between">
          <Link href="/leader" className="flex items-center gap-2">
            <Image src="/brand/mark-white.png" alt="" width={24} height={24} />
            <span className="font-heading text-sm tracking-widest">LEADER PANEL</span>
          </Link>
          <div className="flex items-center gap-4 text-xs">
            <LeaderCommunityPicker communities={leaderOf} />
            <Link
              href="/today"
              className="font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
            >
              MEMBER VIEW
            </Link>
            <span className="text-[color:var(--color-text-muted)] hidden md:inline">{user.email}</span>
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
        <AdminNav scope="leader" />
        <main>{children}</main>
      </div>
    </div>
  );
}
