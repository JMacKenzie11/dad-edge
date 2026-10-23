import { NextRequest, NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { stripeClient } from "@/lib/billing/stripe";
import { handleStripeEvent, type StripeEventLike, type StripeLike } from "@/lib/billing/webhook";
import { appOrigin, deliverActivationInvite } from "@/lib/invites";
import { sendMembershipActiveEmail } from "@/lib/email";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe notifications (DECISIONS.md "Stripe billing"). Only a request
 * signed with STRIPE_WEBHOOK_SECRET gets past the first check. A 500
 * makes Stripe retry later; the handler is safe to repeat.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return new NextResponse("Not configured or unsigned", { status: 400 });

  const stripe = stripeClient();
  const body = await req.text();
  let event: StripeEventLike;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret) as unknown as StripeEventLike;
  } catch {
    return new NextResponse("Bad signature", { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, {
      svc: createSupabaseServiceClient(),
      stripe: stripe as unknown as StripeLike,
      sendInvite: (user, communityName) => deliverActivationInvite(user, { communityName }),
      sendMembershipActive: async (o) => {
        const r = await sendMembershipActiveEmail({ ...o, signInUrl: `${appOrigin()}/login` });
        if (!r.ok) throw new Error(`email failed: ${r.error}`);
      },
      audit: (e) => auditLog({ actor_user_id: null, target_type: "user", ...e }),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("stripe webhook failed", event.type, event.id, err);
    return new NextResponse("Handler failed", { status: 500 });
  }
}
