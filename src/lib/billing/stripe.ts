import Stripe from "stripe";

/**
 * The Stripe client. Keys live in Vercel (production) and .env.local
 * (dev, test mode). No fallback: a missing key fails loudly at first use.
 */
export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
