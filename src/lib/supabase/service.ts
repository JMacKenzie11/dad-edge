import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. NEVER expose to the browser.
 * Bypasses RLS — reserved for admin actions and background jobs.
 * All uses must be audit-logged.
 */
export function createSupabaseServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
