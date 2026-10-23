"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { stripeClient } from "./stripe";
import { appOrigin } from "@/lib/invites";

/**
 * Opens Stripe's customer portal for the signed-in member, where he
 * changes his card or cancels (DECISIONS.md "Stripe billing").
 */
export async function openBillingPortal() {
  const user = await requireUser();
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from("users").select("stripe_customer_id").eq("id", user.id).maybeSingle();
  const customer = (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id;
  if (!customer) redirect("/me/profile?error=" + encodeURIComponent("There's no Stripe billing on this account."));
  const session = await stripeClient().billingPortal.sessions.create({
    customer: customer!,
    return_url: `${appOrigin()}/me/profile`,
  });
  redirect(session.url);
}
