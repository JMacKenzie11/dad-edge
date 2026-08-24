import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Run the Supabase session refresh on every protected request,
 * including /itc/*.
 *
 * The old code skipped /itc entirely — leftover from the pre-
 * auth-phase era when ITC was fully isolated (email-only cookie,
 * no Supabase account). Since the auth phase migration linked
 * /itc onto main-app auth via users.itc_access, /itc's server
 * code reads the Supabase session directly. Without the middleware
 * refresh, the raw cookies that arrived on a /login → /itc
 * redirect chain can be stale (iOS Safari in particular), and
 * requireItcParticipant() ends up seeing no user and bouncing to
 * /login?next=/itc — the exact sign-in loop reported 2026-08-24.
 *
 * The legacy itc_session cookie is scoped to path=/itc/login and
 * isn't touched by updateSession; nothing about the legacy flow
 * changes with this fix.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|design|api/public|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
