import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CallbackBridge } from "./callback-bridge";

export const dynamic = "force-dynamic";

/**
 * Auth callback for password recovery, invite activation, and email
 * confirmation. Two shapes to handle:
 *
 *   1. PKCE  — Supabase sends `?code=...` as a query param. Server-
 *      side we exchange it for a session and redirect to `next`.
 *      Fast path, no client boot needed.
 *
 *   2. Implicit / hash — Supabase sends `#access_token=...&type=...`
 *      in the URL fragment. Fragments never reach the server, so we
 *      render a small client bridge that reads the hash, calls
 *      supabase.auth.setSession(), then routes based on `type`.
 *
 * Which shape you get depends on the Supabase project's Auth Flow
 * setting. This handler supports both so a flow change (or a mix of
 * older links) doesn't break activation.
 */
export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string; error?: string }>;
}) {
  const params = await searchParams;

  // PKCE fast path: server-side exchange, then redirect.
  if (params.code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      redirect(`/login?error=${encodeURIComponent(error.message)}`);
    }
    redirect(params.next ?? "/today");
  }

  // No code. The token might be in the URL hash (implicit flow) —
  // fragments aren't sent to the server, so we defer to the client
  // bridge. If there's also no hash, the bridge will bounce to
  // /login?error=Invalid+link.
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <CallbackBridge nextParam={params.next ?? null} />
    </main>
  );
}
