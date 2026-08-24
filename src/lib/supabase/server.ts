import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items: CookieToSet[]) {
          // cookies().set() only works in Server Actions and Route
          // Handlers. In Server Components the whole cookie store is
          // read-only and set() throws. We want the throw to be
          // silent there (nothing to do about it), BUT we want to
          // see it if it happens in a Server Action — because that's
          // the sign-in cookie loop everyone keeps hitting. Log the
          // count + first error so it surfaces in Vercel logs.
          let failedCount = 0;
          let firstErr: unknown = null;
          for (const { name, value, options } of items) {
            try {
              cookieStore.set(name, value, options);
            } catch (err) {
              failedCount += 1;
              if (!firstErr) firstErr = err;
            }
          }
          if (failedCount > 0) {
            console.warn(
              "[supabase:cookies] setAll failed for %d/%d cookies: %s",
              failedCount,
              items.length,
              firstErr instanceof Error ? firstErr.message : String(firstErr),
            );
          }
        },
      },
    },
  );
}
