import { requireAccess } from "@/lib/session";
import { AppHeader } from "@/components/shell/header";
import { BottomNav, SideNav } from "@/components/shell/nav";
import { HelpWidget } from "@/components/help/help-widget";
import { CurrentHelpViewProvider } from "@/components/help/current-view-context";
import { getNotificationsForBell } from "@/lib/notifications/read";
import { getUnreadThreadCount } from "@/lib/messages/threads";
import { PostHogBridge } from "@/components/analytics/posthog-bridge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, readOnly } = await requireAccess();
  const [{ unreadCount, recent }, unreadMessageThreads] = await Promise.all([
    getNotificationsForBell(),
    getUnreadThreadCount(user.id),
  ]);

  const initials =
    `${(user.first_name ?? user.email[0] ?? "?").slice(0, 1)}${(user.last_name ?? "").slice(0, 1)}`.toUpperCase();

  return (
    <CurrentHelpViewProvider>
      <div className="min-h-screen pb-16 md:pb-0">
        <AppHeader
          userInitials={initials || "•"}
          readOnly={readOnly}
          unreadCount={unreadCount}
          recentNotifications={recent}
          viewerId={user.id}
          unreadMessageThreads={unreadMessageThreads}
        />
        <div className="mx-auto max-w-5xl md:grid md:grid-cols-[220px_1fr]">
          {/* Sticky rail, matching src/app/itc/layout.tsx exactly so the
              nav behaves the same on both sides of the app.

              self-start is load-bearing: a grid item stretches to the
              row height by default, which leaves it nothing to travel
              within, and sticky silently does nothing. top-24 parks it
              under the 96px header (h-20 md:h-24), which is sticky
              itself and would otherwise overlap it. h-[calc(100vh-6rem)]
              plus overflow-y-auto caps it to the rest of the viewport,
              so a nav longer than the window scrolls inside itself
              instead of hiding its last item. */}
          <aside className="hidden md:block border-r border-[color:var(--color-border)] self-start sticky top-24 h-[calc(100vh-6rem)] overflow-y-auto">
            <SideNav
              isPlatformAdmin={user.is_platform_admin}
              unreadMessageThreads={unreadMessageThreads}
            />
          </aside>
          <main className="px-4 md:px-6 py-4 md:py-8">{children}</main>
        </div>
        <BottomNav />
        <HelpWidget role={user.is_platform_admin ? "admin" : "member"} />
        <PostHogBridge userId={user.id} />
      </div>
    </CurrentHelpViewProvider>
  );
}
