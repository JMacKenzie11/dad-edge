import type { SupabaseClient } from "@supabase/supabase-js";
import { grantsAccess, snapshot, userStatusFrom, type SubscriptionLike } from "./state";

/**
 * What a Stripe notification does to memberships (DECISIONS.md "Stripe
 * billing"). The route (src/app/api/stripe/webhook/route.ts) checks the
 * signature and hands the event here.
 *
 * Every subscription event re-reads the subscription from Stripe and
 * syncs to it, so the order notifications arrive in doesn't matter and a
 * repeated delivery changes nothing. Each event id is recorded once in
 * stripe_events; a delivery that already succeeded is skipped.
 *
 * Only memberships with a membership_billing row are Stripe's. A user an
 * admin manages by hand keeps his user-level status while he's entitled.
 */

export type StripeSubscription = SubscriptionLike & {
  customer: string | { id: string };
  metadata: Record<string, string>;
};

export type StripeLike = {
  subscriptions: {
    retrieve(id: string): Promise<StripeSubscription>;
    cancel(id: string): Promise<StripeSubscription>;
  };
  invoicePayments: {
    list(params: { payment: { type: "payment_intent"; payment_intent: string } }): Promise<{
      data: Array<{ invoice: string | { id: string } }>;
    }>;
  };
  invoices: {
    retrieve(id: string): Promise<InvoiceLike>;
  };
};

type InvoiceLike = {
  parent?: { subscription_details?: { subscription: string | { id: string } } | null } | null;
  /** Where the subscription sat before Stripe API 2025-03-31. A webhook
   *  endpoint on an older API version still sends it here. */
  subscription?: string | { id: string } | null;
};

const invoiceSubscription = (inv: InvoiceLike) =>
  idOf(inv.parent?.subscription_details?.subscription ?? inv.subscription);

export type StripeEventLike = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export type WebhookDeps = {
  svc: SupabaseClient;
  stripe: StripeLike;
  /** New account, or one that has never signed in: the set-password invite. */
  sendInvite(user: { id: string; email: string; first_name: string | null }, communityName: string): Promise<string | null>;
  /** Existing account switched on: "you're in" or "you're back in". */
  sendMembershipActive(opts: { to: string; firstName: string | null; communityName: string; returning: boolean }): Promise<void>;
  audit(entry: { action: string; target_id: string | null; metadata: Record<string, unknown> }): Promise<void>;
};

export type WebhookResult = { outcome: "processed" | "duplicate" | "ignored"; detail?: string };

/** ilike with no wildcards: emails can contain "_". */
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

export async function handleStripeEvent(event: StripeEventLike, deps: WebhookDeps): Promise<WebhookResult> {
  const { svc } = deps;

  const { data: seen } = await svc.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (seen?.processed_at) return { outcome: "duplicate" };
  if (!seen) await svc.from("stripe_events").insert({ id: event.id, type: event.type });

  try {
    const detail = await dispatch(event, deps);
    await svc.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return { outcome: detail === "ignored" ? "ignored" : "processed", detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await svc.from("stripe_events").update({ error: message }).eq("id", event.id);
    throw err;
  }
}

async function dispatch(event: StripeEventLike, deps: WebhookDeps): Promise<string> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return "ignored";
      const subId = idOf(obj.subscription as string | { id: string } | null);
      if (!subId) return "ignored";
      return syncSubscription(subId, deps);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return syncSubscription(String(obj.id), deps);
    case "invoice.payment_failed":
    case "invoice.paid": {
      const subId = invoiceSubscription(obj as InvoiceLike);
      if (!subId) return "ignored";
      if (event.type === "invoice.payment_failed") {
        // Keep the first failure's time: the admin list shows how long
        // it's been failing.
        await deps.svc
          .from("membership_billing")
          .update({ payment_failed_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subId)
          .is("payment_failed_at", null);
      } else {
        await deps.svc.from("membership_billing").update({ payment_failed_at: null }).eq("stripe_subscription_id", subId);
      }
      return syncSubscription(subId, deps);
    }
    case "charge.refunded":
      return refund(obj, deps);
    default:
      return "ignored";
  }
}

/** A full refund ends access now: cancel the subscription in Stripe and
 *  sync to the result. A partial refund changes nothing. */
async function refund(charge: Record<string, unknown>, deps: WebhookDeps): Promise<string> {
  if (charge.refunded !== true) return "ignored";
  const pi = idOf(charge.payment_intent as string | { id: string } | null);
  if (!pi) return "ignored";
  // Older API versions put the invoice on the charge; newer ones only
  // link it through invoice payments.
  let invoiceId = idOf(charge.invoice as string | { id: string } | null);
  if (!invoiceId) {
    const payments = await deps.stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi } });
    invoiceId = idOf(payments.data[0]?.invoice);
  }
  if (!invoiceId) return "ignored";
  const invoice = await deps.stripe.invoices.retrieve(invoiceId);
  const subId = invoiceSubscription(invoice);
  if (!subId) return "ignored";
  const current = await deps.stripe.subscriptions.retrieve(subId);
  const sub = grantsAccess(current.status) ? await deps.stripe.subscriptions.cancel(subId) : current;
  await deps.audit({ action: "billing.refund_canceled", target_id: null, metadata: { subscription: subId, payment_intent: pi } });
  return applySubscription(sub, deps);
}

async function syncSubscription(subId: string, deps: WebhookDeps): Promise<string> {
  const sub = await deps.stripe.subscriptions.retrieve(subId);
  return applySubscription(sub, deps);
}

async function applySubscription(sub: StripeSubscription, deps: WebhookDeps): Promise<string> {
  const { svc } = deps;
  const { data: row } = await svc
    .from("membership_billing")
    .select("membership_id, user_id, community_id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();

  if (!row) {
    // Not ours yet. Start a membership only when the subscription grants
    // access and came from our sign-up page (it carries community_id).
    if (!grantsAccess(sub.status) || !sub.metadata?.community_id) return "ignored";
    return onboard(sub, deps);
  }

  const snap = snapshot(sub);
  const now = new Date().toISOString();
  await svc
    .from("membership_billing")
    .update({
      ...snap,
      stripe_customer_id: idOf(sub.customer),
      ...(sub.status === "active" || sub.status === "trialing" ? { payment_failed_at: null } : {}),
      updated_at: now,
    })
    .eq("membership_id", row.membership_id);

  if (grantsAccess(sub.status)) {
    await svc
      .from("memberships")
      .update({ status: "active", deactivated_at: null, canceled_visible_until: null })
      .eq("id", row.membership_id)
      .neq("status", "active");
  } else {
    // Ended: off now, with no read-only window.
    await svc
      .from("memberships")
      .update({ status: "inactive", deactivated_at: now, canceled_visible_until: now })
      .eq("id", row.membership_id)
      .eq("status", "active");
  }
  await syncUserStatus(row.user_id, deps);
  await deps.audit({
    action: grantsAccess(sub.status) ? "billing.synced" : "billing.ended",
    target_id: row.user_id,
    metadata: { subscription: sub.id, status: sub.status, community_id: row.community_id },
  });
  return grantsAccess(sub.status) ? "synced" : "ended";
}

/** A Stripe-billed user's own status follows his Stripe memberships. A
 *  hand-managed user who is still entitled is left alone. */
async function syncUserStatus(userId: string, deps: WebhookDeps): Promise<void> {
  const { svc } = deps;
  const { data: user } = await svc
    .from("users")
    .select("subscription_status, subscription_source")
    .eq("id", userId)
    .maybeSingle();
  if (!user) return;
  if (user.subscription_source === "manual" && user.subscription_status !== "canceled") return;

  const { data: rows } = await svc.from("membership_billing").select("status").eq("user_id", userId);
  const status = userStatusFrom((rows ?? []).map((r) => r.status as string));
  const patch: Record<string, unknown> = { subscription_status: status, subscription_source: "stripe" };
  if (status === "canceled") {
    if (user.subscription_status !== "canceled" || user.subscription_source !== "stripe") patch.canceled_at = new Date().toISOString();
  } else {
    patch.canceled_at = null;
  }
  await svc.from("users").update(patch).eq("id", userId);
}

/**
 * First time we see a paid subscription: find or create the account by
 * email, switch on the membership, record the billing row, and send the
 * right email. A claim row in stripe_events stops two deliveries (the
 * checkout and the subscription notification arrive together) from both
 * doing it.
 */
async function onboard(sub: StripeSubscription, deps: WebhookDeps): Promise<string> {
  const { svc } = deps;
  const claim = `onboard:${sub.id}`;
  const { error: claimErr } = await svc.from("stripe_events").insert({ id: claim, type: "onboard" });
  if (claimErr) return "ignored"; // another delivery is onboarding this subscription

  try {
    const communityId = sub.metadata.community_id;
    const email = (sub.metadata.email ?? "").trim().toLowerCase();
    const firstName = sub.metadata.first_name?.trim() || null;
    const lastName = sub.metadata.last_name?.trim() || null;
    const customerId = idOf(sub.customer);
    if (!email || !customerId) throw new Error(`subscription ${sub.id} has no email or customer`);

    const { data: community } = await svc.from("communities").select("id, name").eq("id", communityId).maybeSingle();
    if (!community) throw new Error(`subscription ${sub.id} names unknown community ${communityId}`);

    // Find or create the account.
    let created = false;
    let { data: user } = await svc
      .from("users")
      .select("id, email, first_name, last_name, stripe_customer_id")
      .ilike("email", likeExact(email))
      .maybeSingle();
    if (!user) {
      const { data: authData, error: authErr } = await svc.auth.admin.createUser({ email, email_confirm: true });
      if (authErr && !/already been registered/i.test(authErr.message)) throw new Error(authErr.message);
      created = Boolean(authData?.user);
      ({ data: user } = await svc
        .from("users")
        .select("id, email, first_name, last_name, stripe_customer_id")
        .ilike("email", likeExact(email))
        .maybeSingle());
      if (!user) throw new Error(`could not create an account for ${email}`);
    }

    const userPatch: Record<string, unknown> = {};
    if (!user.first_name && firstName) userPatch.first_name = firstName;
    if (!user.last_name && lastName) userPatch.last_name = lastName;
    if (!user.stripe_customer_id) userPatch.stripe_customer_id = customerId;
    if (created) {
      userPatch.subscription_source = "stripe";
      userPatch.subscription_status = "trialing";
    }
    if (Object.keys(userPatch).length) await svc.from("users").update(userPatch).eq("id", user.id);

    // Switch the membership on.
    const { data: existing } = await svc
      .from("memberships")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("community_id", community.id)
      .maybeSingle();
    let membershipId: string;
    if (existing) {
      membershipId = existing.id;
      await svc
        .from("memberships")
        .update({ status: "active", deactivated_at: null, canceled_visible_until: null })
        .eq("id", existing.id);
    } else {
      const { data: inserted, error } = await svc
        .from("memberships")
        .insert({ user_id: user.id, community_id: community.id, role: "member", status: "active" })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(error?.message ?? "membership insert failed");
      membershipId = inserted.id;
    }

    const { error: billErr } = await svc.from("membership_billing").upsert(
      {
        membership_id: membershipId,
        user_id: user.id,
        community_id: community.id,
        stripe_customer_id: customerId,
        ...snapshot(sub),
        payment_failed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "membership_id" },
    );
    if (billErr) throw new Error(billErr.message);

    await syncUserStatus(user.id, deps);

    // The email. A man who has never signed in gets the set-password
    // invite even if the account existed (an admin made it, he never
    // used it). Someone already active here gets nothing new.
    const { data: authUser } = await svc.auth.admin.getUserById(user.id);
    const neverSignedIn = !authUser?.user?.last_sign_in_at;
    // A failed email doesn't undo the payment: the membership stands, the
    // failure is kept on the billing row, and /admin/billing lists him so
    // an admin can resend the invite. Throwing here would leave Stripe's
    // retry finding a finished membership and never sending it.
    let email_sent: string;
    let emailError: string | null = null;
    try {
      if (created || neverSignedIn) {
        emailError = await deps.sendInvite({ id: user.id, email: user.email, first_name: user.first_name ?? firstName }, community.name);
        if (!emailError) await svc.from("users").update({ invited_at: new Date().toISOString() }).eq("id", user.id);
        email_sent = "invite";
      } else if (existing?.status === "active") {
        email_sent = "none";
      } else {
        await deps.sendMembershipActive({
          to: user.email,
          firstName: user.first_name ?? firstName,
          communityName: community.name,
          returning: Boolean(existing),
        });
        email_sent = existing ? "back_in" : "joined";
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      email_sent = "failed";
    }
    if (emailError) {
      email_sent = "failed";
      await svc.from("membership_billing").update({ welcome_email_error: emailError.slice(0, 500) }).eq("membership_id", membershipId);
    }

    await deps.audit({
      action: "billing.joined",
      target_id: user.id,
      metadata: { subscription: sub.id, community_id: community.id, created, returning: Boolean(existing), email_sent, email_error: emailError },
    });
    return `joined:${email_sent}`;
  } catch (err) {
    // Release the claim so Stripe's retry can try again.
    await svc.from("stripe_events").delete().eq("id", claim);
    throw err;
  }
}
