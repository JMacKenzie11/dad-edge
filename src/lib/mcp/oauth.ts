import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * An AI app's OAuth token on /api/mcp (DECISIONS.md "MCP sign-in with
 * OAuth"). Supabase's OAuth server issued it after an admin pressed Allow
 * on /oauth/consent; the token hook gave it the no-access role
 * mcp_assistant (migration 20261112000002_mcp_oauth.sql).
 *
 * Accepted only when the signature checks out for this project, the issuer
 * is this project's Auth, it names an app (client_id), it carries the
 * mcp_assistant role, the app is still approved and the person is still a
 * platform admin. The last two are asked again on every request, so taking
 * an app off the list or an admin off the admins cuts it off at once.
 */

export type OAuthCaller = { userId: string; clientId: string };

/** The claim checks that need no database. */
export function claimsProblem(claims: Record<string, unknown>, supabaseUrl: string): string | null {
  if (typeof claims.sub !== "string" || !claims.sub) return "no user";
  if (typeof claims.client_id !== "string" || !claims.client_id) return "not an app token";
  if (claims.iss !== `${supabaseUrl.replace(/\/$/, "")}/auth/v1`) return "wrong issuer";
  if (claims.role !== "mcp_assistant") return "wrong role";
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return "expired";
  return null;
}

export async function verifyOAuthToken(token: string): Promise<OAuthCaller | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // getClaims checks the signature: against the project's published keys
  // for an asymmetric token, or by asking Auth for a symmetric one.
  const { data, error } = await anon.auth.getClaims(token);
  if (error || !data?.claims) return null;
  const claims = data.claims as Record<string, unknown>;
  const problem = claimsProblem(claims, url);
  if (problem) {
    console.warn("[mcp] OAuth token refused: %s", problem);
    return null;
  }
  const userId = claims.sub as string;
  const clientId = claims.client_id as string;
  const svc = createSupabaseServiceClient();
  const [trusted, admin] = await Promise.all([
    svc.rpc("mcp_client_trusted", { p_client_id: clientId }),
    svc.rpc("mcp_user_is_admin", { p_user_id: userId }),
  ]);
  if (trusted.data !== true || admin.data !== true) {
    console.warn("[mcp] OAuth token refused: %s", trusted.data !== true ? "app not approved" : "not an admin");
    return null;
  }
  return { userId, clientId };
}
