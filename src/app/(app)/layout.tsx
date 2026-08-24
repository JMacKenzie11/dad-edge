import { requireAccess } from "@/lib/session";
import { AppHeader } from "@/components/shell/header";
import { BottomNav, SideNav } from "@/components/shell/nav";
import { HelpWidget } from "@/components/help/help-widget";
import { CurrentHelpViewProvider } from "@/components/help/current-view-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, readOnly } = await requireAccess();

  const initials =
    `${(user.first_name ?? user.email[0] ?? "?").slice(0, 1)}${(user.last_name ?? "").slice(0, 1)}`.toUpperCase();

  return (
    <CurrentHelpViewProvider>
      <div className="min-h-screen pb-16 md:pb-0">
        <AppHeader
          userInitials={initials || "•"}
          readOnly={readOnly}
        />
        <div className="mx-auto max-w-5xl md:grid md:grid-cols-[220px_1fr]">
          <aside className="hidden md:block border-r border-[color:var(--color-border)] min-h-[calc(100vh-96px)]">
            <SideNav isPlatformAdmin={user.is_platform_admin} />
          </aside>
          <main className="px-4 md:px-6 py-4 md:py-8">{children}</main>
        </div>
        <BottomNav />
        <HelpWidget role={user.is_platform_admin ? "admin" : "member"} />
      </div>
    </CurrentHelpViewProvider>
  );
}
