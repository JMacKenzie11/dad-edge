"use server";

import { z } from "zod";
import { parseForm } from "@/lib/validation/form-error";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { stripeClient } from "@/lib/billing/stripe";
import { productPrice } from "@/lib/billing/products";
import { checkoutSessionParams } from "@/lib/billing/checkout";
import { appOrigin } from "@/lib/invites";

const JoinSchema = z.object({
  slug: z.string().min(1).max(60),
  first_name: z.string().trim().min(1, "Enter your first name.").max(80),
  last_name: z.string().trim().min(1, "Enter your last name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  embedded: z.enum(["1", "0"]).transform((v) => v === "1"),
});

export type CheckoutResult =
  | { ok: true; clientSecret: string }
  | { ok: true; url: string }
  | { ok: false; error: string };

const CLOSED = "This community isn't open for sign-up.";

/**
 * Starts Stripe Checkout for the community's product. His name and email
 * ride along on the subscription, and the webhook uses them to set up the
 * account once he's paid (src/lib/billing/webhook.ts). Embedded, it
 * returns the client secret the sign-up page mounts the payment form
 * with; otherwise the URL of Stripe's own page.
 */
export async function createCheckout(formData: FormData): Promise<CheckoutResult> {
  const parsed = parseForm(JoinSchema, {
    slug: formData.get("slug"),
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    email: formData.get("email"),
    embedded: formData.get("embedded") === "1" ? "1" : "0",
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { slug, first_name, last_name, email, embedded } = parsed.data;

  const svc = createSupabaseServiceClient();
  const { data: community } = await svc
    .from("communities")
    .select("id, name, slug, status, stripe_product_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!community?.stripe_product_id || community.status !== "active") return { ok: false, error: CLOSED };
  const price = await productPrice(community.stripe_product_id).catch(() => null);
  if (!price) return { ok: false, error: CLOSED };

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
      .eq("community_id", community.id)
      .maybeSingle();
    if (m?.status === "active") return { ok: false, error: `That email is already a member of ${community.name}. Sign in instead.` };
  }

  try {
    const session = await stripeClient().checkout.sessions.create(
      checkoutSessionParams({
        embedded,
        priceId: price.priceId,
        communityId: community.id,
        slug: community.slug,
        origin: appOrigin(),
        person: { email, first_name, last_name },
        customerId: user?.stripe_customer_id ?? null,
      }),
    );
    if (embedded && session.client_secret) return { ok: true, clientSecret: session.client_secret };
    if (!embedded && session.url) return { ok: true, url: session.url };
  } catch (err) {
    console.error("checkout session failed", err);
  }
  return { ok: false, error: "Payment couldn't start. Try again in a minute." };
}
