import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refresh Supabase session on every request. Runs before route handlers.
 * Returns the possibly-mutated response so cookie updates ship to the browser.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(items: CookieToSet[]) {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          items.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser();

  const url = request.nextUrl;
  const isProtected =
    url.pathname.startsWith("/today") ||
    url.pathname.startsWith("/missions") ||
    url.pathname.startsWith("/goals") ||
    url.pathname.startsWith("/community") ||
    url.pathname.startsWith("/me") ||
    url.pathname.startsWith("/coach") ||
    url.pathname.startsWith("/reset-password") ||
    url.pathname.startsWith("/onboarding") ||
    url.pathname.startsWith("/leader") ||
    url.pathname.startsWith("/admin");

  if (isProtected && !user) {
    // Sign-in loop diagnostic: log every unauthenticated protected-
    // page hit so we can see when a redirect chain from /login is
    // failing to carry the session cookie. Includes cookie names
    // (not values) so we can tell whether the session cookie was
    // present at all vs missing entirely.
    const referrer = request.headers.get("referer") ?? "(none)";
    const cookieNames = request.cookies
      .getAll()
      .map((c) => c.name)
      .join(",");
    console.warn(
      "[middleware] unauth on protected path %s · getUser err=%s · referer=%s · cookies=%s",
      url.pathname,
      userErr?.message ?? "none",
      referrer,
      cookieNames || "(none)",
    );
    const redirect = url.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", url.pathname);
    return NextResponse.redirect(redirect);
  }

  return supabaseResponse;
}
