import Image from "next/image";
import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { productPrice } from "@/lib/billing/products";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

/**
 * Public paid sign-up for one community (DECISIONS.md "Stripe billing").
 * He gives his name and email here, pays on Stripe's page, and the
 * webhook sets up his account.
 */
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const svc = createSupabaseServiceClient();
  const { data: community } = await svc
    .from("communities")
    .select("name, slug, status, stripe_product_id")
    .eq("slug", slug)
    .maybeSingle();
  const price =
    community?.stripe_product_id && community.status === "active" && isStripeConfigured()
      ? await productPrice(community.stripe_product_id).catch(() => null)
      : null;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10 gap-8">
      <Image src="/brand/logo-tagline-white.png" alt="THE DAD EDGE - Live Legendary" width={320} height={90} priority />
      <div className="w-full max-w-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-4">
        {!community || !price ? (
          <div>
            <h1 className="font-heading text-2xl">Sign-up is closed</h1>
            <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
              This community isn&apos;t open for sign-up right now.
            </p>
            <Link href="/login" className="block mt-4 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]">
              Already a member? Sign in.
            </Link>
          </div>
        ) : (
          <>
            <div>
              <h1 className="font-heading text-2xl">Join {community.name}</h1>
              <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
                {price.label}. Cancel anytime from your profile.
              </p>
            </div>
            <JoinForm slug={community.slug} />
            <p className="text-xs text-[color:var(--color-text-muted)]">
              Payment is handled securely by Stripe. Then we&apos;ll email you a link to set your password. Already have an account? Use the same email and we&apos;ll add this community to it.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

