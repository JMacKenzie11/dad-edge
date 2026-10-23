"use client";

import { useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { createCheckout } from "./actions";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
// Loaded once per page. Without the key, sign-up falls back to Stripe's
// own checkout page (src/lib/billing/checkout.ts).
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

/**
 * Step one takes his name and email. Step two shows Stripe's payment
 * form on this same page; when he pays, Stripe sends him to the welcome
 * page.
 */
export function JoinForm({ slug }: { slug: string }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState({ first_name: "", last_name: "", email: "" });
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    setDetails({
      first_name: String(formData.get("first_name") ?? ""),
      last_name: String(formData.get("last_name") ?? ""),
      email: String(formData.get("email") ?? ""),
    });
    formData.set("embedded", stripePromise ? "1" : "0");
    startTransition(async () => {
      const result = await createCheckout(formData);
      if (!result.ok) setError(result.error);
      else if ("clientSecret" in result) setClientSecret(result.clientSecret);
      else window.location.assign(result.url);
    });
  }

  if (clientSecret && stripePromise) {
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 text-xs text-[color:var(--color-text-muted)]">
          <span className="truncate">
            {details.first_name} {details.last_name} · {details.email}
          </span>
          <button type="button" onClick={() => setClientSecret(null)} className="shrink-0 hover:text-[color:var(--color-primary)]">
            Change
          </button>
        </div>
        <div className="rounded-md overflow-hidden">
          <EmbeddedCheckoutProvider key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <Field label="FIRST NAME" name="first_name" autoComplete="given-name" defaultValue={details.first_name} autoFocus />
      <Field label="LAST NAME" name="last_name" autoComplete="family-name" defaultValue={details.last_name} />
      <Field label="EMAIL" name="email" type="email" autoComplete="email" defaultValue={details.email} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "ONE MOMENT…" : "CONTINUE TO PAYMENT"}
      </Button>
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  autoFocus,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">{label}</span>
      <input
        type={type}
        name={name}
        required
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        defaultValue={defaultValue}
        className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-[color:var(--color-text)] focus:border-[color:var(--color-primary)]"
      />
    </label>
  );
}
