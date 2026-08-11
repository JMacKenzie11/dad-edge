import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // ITC routes are fully isolated from Supabase auth. Skip the Supabase
  // session refresh so /itc/* requests never resolve an app user. The
  // itc_session cookie is scoped to path=/itc and is never consulted here.
  if (request.nextUrl.pathname.startsWith("/itc")) {
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|design|api/public|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
