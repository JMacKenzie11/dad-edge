import { notFound } from "next/navigation";
import { itcDemoAuthEnabled } from "@/lib/itc/session";
import { HelpWidget } from "@/components/help/help-widget";
import { CurrentHelpViewProvider } from "@/components/help/current-view-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/shell/header";
import { BottomNav } from "@/components/shell/nav";
import { PostHogBridge } from "@/components/analytics/posthog-bridge";
import { getNotificationsForBell } from "@/lib/notifications/read";
import { getUnreadThreadCount } from "@/lib/messages/threads";
import { ItcNavSwitcher } from "./itc-nav-switcher";

/**
 * ITC shell — mirrors src/app/(app)/layout.tsx so ITC pages inherit
 * the same AppHeader (logo, messages, bell, avatar), left rail (via
 * `ItcNavSwitcher` — main-app SideNav elsewhere, stage nav on
 * `/itc/[mapId]/*`), bottom nav on mobile, and help widget.
 *
 * Why not just move /itc/* into the (app) route group? Two reasons:
 * (1) ITC has its own auth path (legacy cookie for pre-migration
 * coachees, in addition to the main-app session) and its own gate
 * (ITC_DEMO_AUTH); moving under (app) would tangle those, and
 * (2) the map canvas at `/itc/[mapId]` wants the left rail SWAPPED
 * for a stage progress nav, which the (app) layout can't do.
 *
 * Fallback: legacy cookie coachees have no main-app auth session so
 * we can't render the header (initials, unread counts, notifications
 * all need a `users` row). In that case we render bare children —
 * matches the pre-integration behavior for those users. Same for the
 * unauthenticated /itc/login page.
 */
export default async function ItcLayout({ children }: { children: React.ReactNode }) {
  if (!itcDemoAuthEnabled()) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return (
      <CurrentHelpViewProvider>
        {children}
        <HelpWidget role="member" />
      </CurrentHelpViewProvider>
    );
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("first_name, last_name, email, is_platform_admin")
    .eq("id", authUser.id)
    .maybeSingle();
  const row = (userRow ?? null) as {
    first_name: string | null;
    last_name: string | null;
    email: string;
    is_platform_admin: boolean;
  } | null;

  if (!row) {
    // Auth session exists but no app users row — legacy cookie path
    // or migration edge case. Fall back to bare children.
    return (
      <CurrentHelpViewProvider>
        {children}
        <HelpWidget role="member" />
      </CurrentHelpViewProvider>
    );
  }

  const initials = `${(row.first_name ?? row.email[0] ?? "?").slice(0, 1)}${(row.last_name ?? "").slice(0, 1)}`.toUpperCase();

  const [{ unreadCount, recent }, unreadMessageThreads] = await Promise.all([
    getNotificationsForBell(),
    getUnreadThreadCount(authUser.id),
  ]);

  return (
    <CurrentHelpViewProvider>
      <div className="min-h-screen pb-16 md:pb-0">
        <AppHeader
          userInitials={initials || "•"}
          readOnly={false}
          unreadCount={unreadCount}
          recentNotifications={recent}
          viewerId={authUser.id}
          unreadMessageThreads={unreadMessageThreads}
        />
        <div className="mx-auto max-w-5xl md:grid md:grid-cols-[220px_1fr]">
          {/* Sticky rail. top-24 (6rem) matches the AppHeader height
              (h-24 on md+) so the rail parks right below the sticky
              header rather than behind it. h-[calc(100vh-6rem)]
              caps it to the remaining viewport so the rail itself
              never scrolls off. */}
          <aside className="hidden md:block border-r border-[color:var(--color-border)] self-start sticky top-24 h-[calc(100vh-6rem)] overflow-y-auto">
            <ItcNavSwitcher
              isPlatformAdmin={row.is_platform_admin}
              unreadMessageThreads={unreadMessageThreads}
            />
          </aside>
          <main className="px-4 md:px-6 py-4 md:py-8">{children}</main>
        </div>
        <BottomNav />
        <HelpWidget role="member" />
        <PostHogBridge userId={authUser.id} />
      </div>
    </CurrentHelpViewProvider>
  );
}
