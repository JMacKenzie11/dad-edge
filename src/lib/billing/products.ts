import type Stripe from "stripe";
import { stripeClient } from "./stripe";

export type ProductOption = { id: string; name: string; price: string | null };

/** "$49.00 / month". Null when the product has no recurring default price. */
export function priceLabel(price: Pick<Stripe.Price, "unit_amount" | "currency" | "recurring"> | null): string | null {
  if (!price || price.unit_amount == null || !price.recurring) return null;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(price.unit_amount / 100);
  const { interval, interval_count } = price.recurring;
  return interval_count === 1 ? `${amount} / ${interval}` : `${amount} every ${interval_count} ${interval}s`;
}

/** Active products, for the admin picker. */
export async function listProducts(): Promise<ProductOption[]> {
  const res = await stripeClient().products.list({ active: true, limit: 100, expand: ["data.default_price"] });
  return res.data.map((p) => ({
    id: p.id,
    name: p.name,
    price: priceLabel(typeof p.default_price === "object" ? (p.default_price as Stripe.Price) : null),
  }));
}

/** The product's default price, which checkout charges. */
export async function productPrice(productId: string): Promise<{ priceId: string; label: string } | null> {
  const p = await stripeClient().products.retrieve(productId, { expand: ["default_price"] });
  const price = typeof p.default_price === "object" ? (p.default_price as Stripe.Price) : null;
  const label = priceLabel(price);
  if (!p.active || !price || !label) return null;
  return { priceId: price.id, label };
}
