"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Bottom nav (mobile only) — 5 core routes at the ergonomic cap.
 * Leaderboard shows on mobile too since it's a first-class member
 * surface, not a side dish.
 */
const items = [
  { href: "/today", label: "Today", icon: "▣" },
  { href: "/missions", label: "Missions", icon: "◆" },
  { href: "/coach", label: "Coach Larry", icon: "◐" },
  { href: "/community", label: "Leaderboard", icon: "◈" },
  { href: "/me", label: "Me", icon: "●" },
] as const;

/**
 * Left-nav-only entries. My Braveman (personal analytics) sits at
 * the top; Goals under it. Leaderboard immediately follows on the
 * desktop nav per product decision 2026-08-24 — planning and
 * comparison surfaces group together above the daily work items.
 */
const dashboardItem = { href: "/dashboard", label: "My Braveman", icon: "▤" } as const;
const goalsItem = { href: "/goals", label: "Goals", icon: "◎" } as const;
const leaderboardItem = { href: "/community", label: "Leaderboard", icon: "◈" } as const;

const adminItem = { href: "/admin", label: "Admin", icon: "⚙" } as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-[color:var(--color-bg)] border-t border-[color:var(--color-border)]">
      <ul className="grid grid-cols-5">
        {items.map((it) => {
          const active = pathname.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-heading tracking-widest",
                  active
                    ? "text-[color:var(--color-accent)]"
                    : "text-[color:var(--color-text-muted)]",
                )}
              >
                <span className="text-lg leading-none">{it.icon}</span>
                <span>{it.label.toUpperCase()}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav({ isPlatformAdmin = false }: { isPlatformAdmin?: boolean }) {
  const pathname = usePathname();
  // Desktop order: My Braveman → Leaderboard → Goals → daily
  // items (Today, Missions, Coach Larry, Me) → Admin (if platform
  // admin). "Brothers" in the bottom nav is called "Leaderboard"
  // here too — same route, one label everywhere.
  const dailyItems = items.filter((it) => it.href !== "/community");
  const navItems = isPlatformAdmin
    ? [dashboardItem, leaderboardItem, goalsItem, ...dailyItems, adminItem]
    : [dashboardItem, leaderboardItem, goalsItem, ...dailyItems];
  return (
    <nav className="hidden md:flex flex-col gap-1 p-4">
      {navItems.map((it) => {
        const active = pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "flex items-center gap-3 h-11 px-3 rounded-md font-heading text-sm tracking-wide",
              active
                ? "bg-[color:var(--color-surface)] text-[color:var(--color-accent)]"
                : "text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-surface)]",
            )}
          >
            <span className="text-base">{it.icon}</span>
            {it.label.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}
