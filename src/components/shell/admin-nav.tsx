"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

type NavItem = { href: string; label: string; exact?: boolean };

const adminItems: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/communities", label: "Communities" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/disengagement", label: "Disengagement" },
  { href: "/admin/coach-flags", label: "Coach flags" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/audit", label: "Audit log" },
];

const leaderItems: NavItem[] = [
  { href: "/leader", label: "Overview", exact: true },
  { href: "/leader/members", label: "Members" },
  { href: "/leader/disengagement", label: "Disengagement" },
  { href: "/leader/nudges", label: "Nudges" },
  { href: "/leader/corrections", label: "Corrections" },
];

export function AdminNav({ scope }: { scope: "admin" | "leader" }) {
  const pathname = usePathname();
  const items = scope === "admin" ? adminItems : leaderItems;
  return (
    <nav className="flex gap-1 flex-wrap border-b border-[color:var(--color-border)] pb-2">
      {items.map((it) => {
        const active = it.exact
          ? pathname === it.href
          : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "h-9 px-3 rounded-md font-heading text-xs tracking-widest flex items-center",
              active
                ? "bg-[color:var(--color-surface)] text-[color:var(--color-accent)]"
                : "text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-surface)]",
            )}
          >
            {it.label.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}
