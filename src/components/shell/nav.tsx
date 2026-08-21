"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const items = [
  { href: "/today", label: "Today", icon: "▣" },
  { href: "/missions", label: "Missions", icon: "◆" },
  { href: "/coach", label: "Coach", icon: "◐" },
  { href: "/community", label: "Brothers", icon: "◈" },
  { href: "/me", label: "Me", icon: "●" },
] as const;

/** Left-menu-only entries. Not in the mobile bottom nav (which is
 *  at its 5-slot ergonomic cap). Dashboard is reachable on mobile
 *  via /me's top card; Goals is reachable via the "Manage goals"
 *  button on /missions. */
const dashboardItem = { href: "/dashboard", label: "Dashboard", icon: "▤" } as const;
const goalsItem = { href: "/goals", label: "Goals", icon: "◎" } as const;

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
  // Dashboard + Goals sit at the top of the desktop left menu
  // (planning/analytical surfaces above the daily work). Neither is
  // in the mobile bottom nav (5-slot ergonomic cap); mobile users
  // reach Dashboard via /me and Goals via the /missions "Manage
  // goals" button.
  const navItems = isPlatformAdmin
    ? [dashboardItem, goalsItem, ...items, adminItem]
    : [dashboardItem, goalsItem, ...items];
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
