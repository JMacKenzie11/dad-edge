import { notFound } from "next/navigation";
import { itcDemoAuthEnabled } from "@/lib/itc/session";
import { HelpWidget } from "@/components/help/help-widget";
import { CurrentHelpViewProvider } from "@/components/help/current-view-context";

/**
 * Gate for the entire /itc/* tree. When ITC_DEMO_AUTH != "1", every ITC
 * route (including /itc/login) 404s. Kept intentionally spartan — this
 * is an ad-hoc demo, not a first-class product surface.
 *
 * The Help widget is mounted here so it appears on every /itc page,
 * including /itc/login and /itc/no-access. The CurrentHelpView
 * provider lets the ITC map canvas signal the active stage as it
 * changes, without a URL change.
 *
 * Note: /itc/login and /itc/no-access don't have a resolved user
 * yet — the widget always tags requests as role='member' here since
 * itc_access implies coachee. Admins hitting /itc still get 'member'
 * content, which is what they want (help for the ITC coachee flow,
 * not admin surfaces).
 */
export default function ItcLayout({ children }: { children: React.ReactNode }) {
  if (!itcDemoAuthEnabled()) {
    notFound();
  }
  return (
    <CurrentHelpViewProvider>
      {children}
      <HelpWidget role="member" />
    </CurrentHelpViewProvider>
  );
}
