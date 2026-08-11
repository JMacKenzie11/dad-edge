import { notFound } from "next/navigation";
import { itcDemoAuthEnabled } from "@/lib/itc/session";

/**
 * Gate for the entire /itc/* tree. When ITC_DEMO_AUTH != "1", every ITC
 * route (including /itc/login) 404s. Kept intentionally spartan — this
 * is an ad-hoc demo, not a first-class product surface.
 */
export default function ItcLayout({ children }: { children: React.ReactNode }) {
  if (!itcDemoAuthEnabled()) {
    notFound();
  }
  return <>{children}</>;
}
