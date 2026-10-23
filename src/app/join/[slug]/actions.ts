"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { parseForm } from "@/lib/validation/form-error";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { stripeClient } from "@/lib/billing/stripe";
import { productPrice } from "@/lib/billing/products";
import { appOrigin } from "@/lib/invites";

const JoinSchema = z.object({
  slug: z.string().min(1).max(60),
  first_name: z.string().trim().min(1, "Enter your first name.").max(80),
  last_name: z.string().trim().min(1, "Enter your last name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
});

/**
 * Sends him to Stripe Checkout for the community's product. His name and
 * email ride along on the subscription, and the webhook uses them to set
 * up the account once he's paid (src/lib/billing/webhook.ts).
 */
export async function startCheckout(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const back = (msg: string) => redirect(`/join/${encodeURIComponent(slug)}?error=${encodeURIComponent(msg)}`);
  const parsed = parseForm(JoinSchema, {
    slug,
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    email: formData.get("email"),
  });
  if (!parsed.ok) back(parsed.error);
  const { first_name, last_name, email } = parsed.ok ? parsed.data : ({} as never);

  const svc = createSupabaseServiceClient();
  const { data: community } = await svc
    .from("communities")
    .select("id, name, slug, status, stripe_product_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!community?.stripe_product_id || community.status !== "active") back("This community isn't open for sign-up.");
  const price = await productPrice(community!.stripe_product_id!);
  if (!price) back("This community isn't open for sign-up.");

  // Already in? Don't take a second payment for the same place.
  const { data: user } = await svc
    .from("users")
    .select("id, stripe_customer_id")
    .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .maybeSingle();
  if (user) {
    const { data: m } = await svc
      .from("memberships")
      .select("status")
      .eq("user_id", user.id)
      .eq("community_id", community!.id)
      .maybeSingle();
    if (m?.status === "active") back(`That email is already a member of ${community!.name}. Sign in instead.`);
  }

  const metadata = { community_id: community!.id, email, first_name, last_name };
  const origin = appOrigin();
  const session = await stripeClient().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price!.priceId, quantity: 1 }],
    ...(user?.stripe_customer_id ? { customer: user.stripe_customer_id } : { customer_email: email }),
    allow_promotion_codes: true,
    subscription_data: { metadata },
    metadata,
    success_url: `${origin}/join/${community!.slug}/welcome`,
    cancel_url: `${origin}/join/${community!.slug}`,
  });
  if (!session.url) back("Stripe didn't return a checkout page. Try again.");
  redirect(session.url!);
}
