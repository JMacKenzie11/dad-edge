import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign out and land on the public login page. Explicit 303 See
 * Other so the browser converts our POST into a GET — a default 307
 * redirect would re-issue POST to /login, which is a GET-only page
 * and 405s back as a blank screen.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(new URL("/login", origin), { status: 303 });
}
