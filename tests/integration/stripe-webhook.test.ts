import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canAccess } from "../../src/lib/entitlement";
import { handleStripeEvent, type StripeLike, type StripeSubscription, type WebhookDeps } from "../../src/lib/billing/webhook";
import { authedAs, createCommunity, createTestUser, deleteCommunities, deleteUsers, service } from "./helpers/supabase";

/**
 * The Stripe webhook against the dev database, with Stripe itself
 * replaced by an in-memory stand-in: the notifications are shaped like
 * Stripe's, and the handler re-reads subscriptions from the stand-in the
 * way it re-reads them from Stripe. Covers each rule in DECISIONS.md
 * "Stripe billing".
 */

type Sent = { kind: "invite" | "active"; to: string; returning?: boolean; community: string };

const svc = service();
const subs = new Map<string, StripeSubscription>();
const invoices = new Map<string, string>(); // invoice id -> subscription id
const payments = new Map<string, string>(); // payment intent -> invoice id
const canceled: string[] = [];
let sent: Sent[] = [];

const stripe: StripeLike = {
  subscriptions: {
    retrieve: async (id) => structuredClone(subs.get(id)!),
    cancel: async (id) => {
      canceled.push(id);
      const s = subs.get(id)!;
      s.status = "canceled";
      s.ended_at = Math.floor(Date.now() / 1000);
      return structuredClone(s);
    },
  },
  invoicePayments: {
    list: async ({ payment }) => ({ data: [{ invoice: payments.get(payment.payment_intent)! }] }),
  },
  invoices: {
    retrieve: async (id) => ({ parent: { subscription_details: { subscription: invoices.get(id)! } } }),
  },
};

const deps: WebhookDeps = {
  svc,
  stripe,
  sendInvite: async (user, community) => {
    if (user.email.includes("bounce")) return "Email address is invalid";
    sent.push({ kind: "invite", to: user.email, community });
    return null;
  },
  sendMembershipActive: async (o) => {
    sent.push({ kind: "active", to: o.to, returning: o.returning, community: o.communityName });
  },
  audit: async () => {},
};

let n = 0;
const evt = (type: string, object: Record<string, unknown>) => ({ id: `evt_it_${randomUUID()}`, type, data: { object } });
const periodEnd = () => Math.floor(Date.now() / 1000) + 30 * 86400;

function newSub(communityId: string, email: string, extra: Partial<StripeSubscription> = {}): StripeSubscription {
  const id = `sub_it_${randomUUID().slice(0, 12)}_${n++}`;
  const sub: StripeSubscription = {
    id,
    status: "active",
    cancel_at_period_end: false,
    ended_at: null,
    customer: `cus_it_${email.split("@")[0].slice(-12)}`,
    metadata: { community_id: communityId, email, first_name: "Jordan", last_name: "Tester" },
    items: { data: [{ current_period_end: periodEnd() }] },
    ...extra,
  };
  subs.set(id, sub);
  return sub;
}

const checkoutDone = (sub: StripeSubscription) => evt("checkout.session.completed", { mode: "subscription", subscription: sub.id });

async function userByEmail(email: string) {
  const { data } = await svc.from("users").select("id, subscription_status, subscription_source, canceled_at, first_name, last_name, stripe_customer_id").ilike("email", email).maybeSingle();
  return data;
}
async function membership(userId: string, communityId: string) {
  const { data } = await svc.from("memberships").select("id, status, deactivated_at, canceled_visible_until").eq("user_id", userId).eq("community_id", communityId).maybeSingle();
  return data;
}
async function billing(subId: string) {
  const { data } = await svc.from("membership_billing").select("status, payment_failed_at, cancel_at_period_end").eq("stripe_subscription_id", subId).maybeSingle();
  return data;
}

const communities: string[] = [];
const users: string[] = [];
let commA = "";
let commB = "";

beforeAll(async () => {
  commA = (await createCommunity("stripe-a")).id;
  commB = (await createCommunity("stripe-b")).id;
  communities.push(commA, commB);
});

afterAll(async () => {
  const subIds = [...subs.keys()];
  await svc.from("stripe_events").delete().like("id", "evt_it_%");
  await svc.from("stripe_events").delete().in("id", subIds.map((s) => `onboard:${s}`));
  await deleteUsers(users);
  await deleteCommunities(communities);
});

describe("Stripe webhook", () => {
  const email = `it+stripe-new-${randomUUID().slice(0, 8)}@braveman.test`;
  let first: StripeSubscription;

  it("a new email that pays gets an account, the membership and one invite", async () => {
    sent = [];
    first = newSub(commA, email);
    const checkout = checkoutDone(first);
    // Stripe sends the checkout and subscription notifications at the
    // same moment, so they're handled at the same time here too.
    await Promise.allSettled([
      handleStripeEvent(checkout, deps),
      handleStripeEvent(evt("customer.subscription.created", { id: first.id }), deps),
      handleStripeEvent(evt("customer.subscription.updated", { id: first.id }), deps),
    ]);
    // And redelivers the checkout one.
    expect((await handleStripeEvent(checkout, deps)).outcome).toBe("duplicate");

    const u = await userByEmail(email);
    expect(u).toMatchObject({ subscription_status: "active", subscription_source: "stripe", first_name: "Jordan", last_name: "Tester", stripe_customer_id: first.customer });
    users.push(u!.id);
    expect((await membership(u!.id, commA))?.status).toBe("active");
    expect((await billing(first.id))?.status).toBe("active");
    expect(sent).toEqual([{ kind: "invite", to: email, community: expect.stringContaining("stripe-a") }]);
  });

  it("a failed payment marks him past due and keeps his access; a paid invoice clears it", async () => {
    first.status = "past_due";
    await handleStripeEvent(evt("invoice.payment_failed", { parent: { subscription_details: { subscription: first.id } } }), deps);
    const u = await userByEmail(email);
    expect((await billing(first.id))?.payment_failed_at).not.toBeNull();
    expect(u?.subscription_status).toBe("past_due");
    expect(canAccess(u as never).access).toBe("full");
    expect((await membership(u!.id, commA))?.status).toBe("active");

    first.status = "active";
    await handleStripeEvent(evt("invoice.paid", { parent: { subscription_details: { subscription: first.id } } }), deps);
    expect((await billing(first.id))?.payment_failed_at).toBeNull();
    expect((await userByEmail(email))?.subscription_status).toBe("active");
  });

  it("cancelling keeps access until the period ends, then cuts him off with no read-only window", async () => {
    first.cancel_at_period_end = true;
    await handleStripeEvent(evt("customer.subscription.updated", { id: first.id }), deps);
    const u = await userByEmail(email);
    expect((await membership(u!.id, commA))?.status).toBe("active");
    expect((await billing(first.id))?.cancel_at_period_end).toBe(true);

    // Period over: Stripe deletes the subscription.
    first.status = "canceled";
    first.ended_at = Math.floor(Date.now() / 1000);
    await handleStripeEvent(evt("customer.subscription.deleted", { id: first.id }), deps);
    const after = await userByEmail(email);
    const m = await membership(u!.id, commA);
    expect(m?.status).toBe("inactive");
    expect(m?.canceled_visible_until).toBe(m?.deactivated_at);
    expect(after).toMatchObject({ subscription_status: "canceled", subscription_source: "stripe" });
    expect(canAccess({ ...(after as never), deactivated_at: after?.canceled_at }).access).toBe("none");
  });

  it("coming back reuses the same account and sends 'you're back in', not an invite", async () => {
    const u = await userByEmail(email);
    // He has signed in before, so he isn't sent a set-password link.
    const password = `Test-${randomUUID()}`;
    await svc.auth.admin.updateUserById(u!.id, { password });
    await authedAs(email, password);

    sent = [];
    const again = newSub(commA, email.toUpperCase());
    await handleStripeEvent(checkoutDone(again), deps);
    const back = await userByEmail(email);
    expect(back?.id).toBe(u!.id);
    expect(back?.subscription_status).toBe("active");
    expect((await membership(u!.id, commA))?.status).toBe("active");
    expect(sent).toEqual([{ kind: "active", to: email, returning: true, community: expect.stringContaining("stripe-a") }]);
  });

  it("a full refund ends access straight away", async () => {
    const u = await userByEmail(email);
    const live = [...subs.values()].find((s) => s.status === "active" && s.metadata.email.toLowerCase() === email)!;
    invoices.set("in_it_refund", live.id);
    payments.set("pi_it_refund", "in_it_refund");
    await handleStripeEvent(evt("charge.refunded", { refunded: true, payment_intent: "pi_it_refund" }), deps);
    expect(canceled).toContain(live.id);
    expect((await membership(u!.id, commA))?.status).toBe("inactive");
    expect((await userByEmail(email))?.subscription_status).toBe("canceled");
  });

  it("a partial refund changes nothing", async () => {
    const before = canceled.length;
    await handleStripeEvent(evt("charge.refunded", { refunded: false, payment_intent: "pi_it_partial" }), deps);
    expect(canceled.length).toBe(before);
  });

  it("a hand-managed (comped) member who pays for a second community keeps his own status", async () => {
    const comped = await createTestUser("stripe-comped");
    users.push(comped.id);
    await svc.from("users").update({ subscription_status: "comped", subscription_source: "manual" }).eq("id", comped.id);
    await svc.from("memberships").insert({ user_id: comped.id, community_id: commA, role: "member", status: "active" });
    await authedAs(comped.email, comped.password);

    sent = [];
    const sub = newSub(commB, comped.email);
    await handleStripeEvent(checkoutDone(sub), deps);
    expect((await membership(comped.id, commB))?.status).toBe("active");
    expect(sent).toEqual([{ kind: "active", to: comped.email, returning: false, community: expect.stringContaining("stripe-b") }]);

    sub.status = "canceled";
    await handleStripeEvent(evt("customer.subscription.deleted", { id: sub.id }), deps);
    expect((await membership(comped.id, commB))?.status).toBe("inactive");
    expect((await membership(comped.id, commA))?.status).toBe("active");
    expect(await userByEmail(comped.email)).toMatchObject({ subscription_status: "comped", subscription_source: "manual" });
  });

  it("reads a failed invoice in Stripe's older notification format", async () => {
    const oldEmail = `it+stripe-old-${randomUUID().slice(0, 8)}@braveman.test`;
    const sub = newSub(commA, oldEmail);
    await handleStripeEvent(checkoutDone(sub), deps);
    users.push((await userByEmail(oldEmail))!.id);
    sub.status = "past_due";
    // Before API 2025-03-31 the invoice named its subscription directly.
    await handleStripeEvent(evt("invoice.payment_failed", { subscription: sub.id }), deps);
    expect((await billing(sub.id))?.payment_failed_at).not.toBeNull();
  });

  it("a failed invite email still lets him in, and is kept for an admin to resend", async () => {
    const bounce = `it+stripe-bounce-${randomUUID().slice(0, 8)}@braveman.test`;
    const sub = newSub(commA, bounce);
    expect((await handleStripeEvent(checkoutDone(sub), deps)).detail).toBe("joined:failed");
    const u = await userByEmail(bounce);
    users.push(u!.id);
    expect((await membership(u!.id, commA))?.status).toBe("active");
    const { data: row } = await svc.from("membership_billing").select("welcome_email_error").eq("stripe_subscription_id", sub.id).single();
    expect(row?.welcome_email_error).toMatch(/invalid/);
  });

  it("ignores a subscription that didn't come from our sign-up page", async () => {
    const stray = newSub(commA, `it+stripe-stray-${randomUUID().slice(0, 8)}@braveman.test`, { metadata: {} });
    expect((await handleStripeEvent(evt("customer.subscription.created", { id: stray.id }), deps)).outcome).toBe("ignored");
  });
});
