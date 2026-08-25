import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMembership,
  authedAs,
  canonicalPair,
  createCommunity,
  createTestUser,
  deleteCommunities,
  deleteUsers,
  service,
  type TestUser,
} from "./helpers/supabase";

/**
 * Messaging RLS boundary.
 *
 * The rules the schema promises (see 20260825000002_messages.sql):
 *
 *   1. Two members of the same community can open a thread and exchange
 *      messages.
 *   2. A member CANNOT open a thread with someone outside their
 *      community — the insert on message_threads is rejected by the
 *      "shared community" RLS policy.
 *   3. A non-participant CANNOT read messages in someone else's
 *      thread — SELECT returns zero rows (RLS filters silently).
 *   4. A non-participant CANNOT insert a message into someone else's
 *      thread — INSERT is rejected.
 *
 * A regression in any of these is invisible in the UI until a user
 * reports a leak, so these tests are the guardrail.
 */

let alice: TestUser; // community A member
let bob: TestUser; //   community A member
let carol: TestUser; // community B member — outsider to alice/bob's community
let communityA: { id: string };
let communityB: { id: string };

let aliceClient: SupabaseClient;
let bobClient: SupabaseClient;
let carolClient: SupabaseClient;

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([
    createTestUser("alice"),
    createTestUser("bob"),
    createTestUser("carol"),
  ]);
  [communityA, communityB] = await Promise.all([
    createCommunity("A"),
    createCommunity("B"),
  ]);
  await Promise.all([
    addMembership(alice.id, communityA.id),
    addMembership(bob.id, communityA.id),
    addMembership(carol.id, communityB.id),
  ]);
  [aliceClient, bobClient, carolClient] = await Promise.all([
    authedAs(alice.email, alice.password),
    authedAs(bob.email, bob.password),
    authedAs(carol.email, carol.password),
  ]);
});

afterAll(async () => {
  await deleteUsers([alice.id, bob.id, carol.id].filter(Boolean));
  await deleteCommunities([communityA.id, communityB.id].filter(Boolean));
});

describe("messaging RLS", () => {
  it("same-community pair can create a thread and exchange messages", async () => {
    const [pA, pB] = canonicalPair(alice.id, bob.id);

    const { data: thread, error: threadErr } = await aliceClient
      .from("message_threads")
      .insert({ participant_a: pA, participant_b: pB })
      .select("id")
      .single();
    expect(threadErr).toBeNull();
    expect(thread?.id).toBeTruthy();
    const threadId = thread!.id as string;

    const { data: sent, error: sendErr } = await aliceClient
      .from("messages")
      .insert({ thread_id: threadId, sender_id: alice.id, body: "hey brother" })
      .select("id")
      .single();
    expect(sendErr).toBeNull();
    expect(sent?.id).toBeTruthy();

    // Bob (the other participant) can read what Alice sent.
    const { data: bobRead, error: bobReadErr } = await bobClient
      .from("messages")
      .select("id, body, sender_id")
      .eq("thread_id", threadId);
    expect(bobReadErr).toBeNull();
    expect(bobRead).toHaveLength(1);
    expect(bobRead![0].body).toBe("hey brother");

    // Bob can reply.
    const { error: replyErr } = await bobClient
      .from("messages")
      .insert({ thread_id: threadId, sender_id: bob.id, body: "hey back" });
    expect(replyErr).toBeNull();

    // Cleanup so the next test starts with a clean pair.
    const svc = service();
    await svc.from("message_threads").delete().eq("id", threadId);
  });

  it("rejects a thread insert when the two users share no community", async () => {
    const [pA, pB] = canonicalPair(alice.id, carol.id);

    const { data, error } = await aliceClient
      .from("message_threads")
      .insert({ participant_a: pA, participant_b: pB })
      .select("id");

    // The "shared community" WITH CHECK fails → RLS violation error,
    // no row returned.
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // Belt-and-suspenders: confirm no row snuck through.
    const svc = service();
    const { data: rows } = await svc
      .from("message_threads")
      .select("id")
      .eq("participant_a", pA)
      .eq("participant_b", pB);
    expect(rows ?? []).toHaveLength(0);
  });

  it("non-participant SELECT on messages returns zero rows", async () => {
    // Set up a thread between alice and bob with one message.
    const [pA, pB] = canonicalPair(alice.id, bob.id);
    const svc = service();
    const { data: thread } = await svc
      .from("message_threads")
      .insert({ participant_a: pA, participant_b: pB })
      .select("id")
      .single();
    const threadId = thread!.id as string;
    await svc
      .from("messages")
      .insert({ thread_id: threadId, sender_id: alice.id, body: "private" });

    try {
      // Carol has no membership in community A and isn't a participant.
      // SELECT should return zero rows, no error (RLS filters silently).
      const { data, error } = await carolClient
        .from("messages")
        .select("id, body")
        .eq("thread_id", threadId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      // Same for the thread row itself.
      const { data: threadRows, error: threadErr } = await carolClient
        .from("message_threads")
        .select("id")
        .eq("id", threadId);
      expect(threadErr).toBeNull();
      expect(threadRows ?? []).toHaveLength(0);
    } finally {
      await svc.from("message_threads").delete().eq("id", threadId);
    }
  });

  it("rejects a non-participant INSERT into someone else's thread", async () => {
    const [pA, pB] = canonicalPair(alice.id, bob.id);
    const svc = service();
    const { data: thread } = await svc
      .from("message_threads")
      .insert({ participant_a: pA, participant_b: pB })
      .select("id")
      .single();
    const threadId = thread!.id as string;

    try {
      const { data, error } = await carolClient
        .from("messages")
        .insert({ thread_id: threadId, sender_id: carol.id, body: "sneaky" })
        .select("id");
      expect(error).not.toBeNull();
      expect(data).toBeNull();

      // Confirm no message row landed.
      const { data: rows } = await svc
        .from("messages")
        .select("id")
        .eq("thread_id", threadId);
      expect(rows ?? []).toHaveLength(0);
    } finally {
      await svc.from("message_threads").delete().eq("id", threadId);
    }
  });
});
