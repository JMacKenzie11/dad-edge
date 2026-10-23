import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The signed-in member's own Stripe billing, read under his own
 *  permissions (membership_billing: self read). */
export async function myBilling(): Promise<{ hasStripe: boolean; paymentFailing: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("membership_billing").select("status, payment_failed_at");
  const rows = (data ?? []) as Array<{ status: string; payment_failed_at: string | null }>;
  return {
    hasStripe: rows.length > 0,
    paymentFailing: rows.some((r) => r.status === "past_due" || (r.payment_failed_at !== null && r.status !== "canceled")),
  };
}
