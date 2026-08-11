import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Auth callback for:
 *   - password recovery (PKCE `?code=…`, `next` = `/reset-password`)
 *   - email confirmation on signup (`?code=…`, `next` = `/today` or wherever)
 *
 * Supabase's PKCE flow returns a `code` we exchange for a session. On success
 * we bounce to `next`. On failure we send the user back to /login with an error.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/today";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL(`/login?error=Invalid+link`, url.origin));
}
