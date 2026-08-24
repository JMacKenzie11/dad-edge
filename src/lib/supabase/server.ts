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
          // Handlers. In Server Components the store is read-only
          // and set() throws. Tolerate the failure there, but always
          // log ANY setAll call — success or fail — so we can see in
          // Vercel Functions logs whether sign-in / reset writes are
          // making it to the response.
          let failedCount = 0;
          let firstErr: unknown = null;
          const names = items.map((i) => i.name).join(",");
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
              "[supabase:cookies] setAll FAILED %d/%d cookies (names: %s): %s",
              failedCount,
              items.length,
              names,
              firstErr instanceof Error ? firstErr.message : String(firstErr),
            );
          } else {
            console.info(
              "[supabase:cookies] setAll ok (%d cookies: %s)",
              items.length,
              names,
            );
          }
        },
      },
    },
  );
}
