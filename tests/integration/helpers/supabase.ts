import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * Integration-test helpers for RLS + boundary tests.
 *
 * Runs against the DEV Supabase project configured in .env.local. Tests
 * create real auth users + real communities so RLS policies fire exactly
 * as they do in prod. Every fixture is namespaced with a random suffix
 * so parallel runs and re-runs don't collide, and cleanup runs in
 * afterAll() to keep the dev DB tidy.
 *
 * Two client flavors:
 *   - service():  bypasses RLS. Used for fixture setup + cleanup only.
 *   - authedAs(): anon key with a user session. This is what tests
 *                 actually exercise — the RLS policies apply exactly
 *                 as they would to a browser client.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[integration test] missing env var ${name}`);
  return v;
}

export function service(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function authedAs(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`[integration test] sign-in failed for ${email}: ${error.message}`);
  return client;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createTestUser(labelHint = "user"): Promise<TestUser> {
  const svc = service();
  const suffix = randomUUID().slice(0, 8);
  const email = `it+${labelHint}-${suffix}@braveman.test`;
  const password = `Test-${randomUUID()}`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`[integration test] createUser failed: ${error?.message}`);
  }
  return { id: data.user.id, email, password };
}

export async function createCommunity(labelHint = "community"): Promise<{ id: string; slug: string }> {
  const svc = service();
  const suffix = randomUUID().slice(0, 8);
  const slug = `it-${suffix}`;
  // "[IT-TEST]" prefix so orphans left behind by an interrupted test run
  // are trivially identifiable + sweepable via SQL. The nightly digest
  // job filters these out (see runWeeklyDigest) so a lingering test
  // community can't blast platform admins with a spurious digest email.
  const name = `[IT-TEST] ${labelHint} ${suffix}`;
  const { data, error } = await svc
    .from("communities")
    .insert({ name, slug })
    .select("id, slug")
    .single();
  if (error || !data) throw new Error(`[integration test] createCommunity: ${error?.message}`);
  const communityId = data.id as string;

  // Migration 20260824000002 installs a trigger that auto-provisions
  // every platform admin as a leader of every new community. Great for
  // real communities; catastrophic for tests, which end up shipping
  // digest emails to real admins. Purge those synthetic memberships
  // so the test community has ONLY the users the test explicitly adds.
  await svc.from("memberships").delete().eq("community_id", communityId);
  return { id: communityId, slug: data.slug as string };
}

export async function addMembership(
  userId: string,
  communityId: string,
  opts: { role?: "member" | "leader"; status?: "active" | "inactive" | "removed" } = {},
): Promise<void> {
  const svc = service();
  const { error } = await svc.from("memberships").insert({
    user_id: userId,
    community_id: communityId,
    role: opts.role ?? "member",
    status: opts.status ?? "active",
  });
  if (error) throw new Error(`[integration test] addMembership: ${error.message}`);
}

export async function deleteUsers(userIds: string[]): Promise<void> {
  const svc = service();
  for (const id of userIds) {
    // Cascades to public.users via FK on delete cascade.
    await svc.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

export async function deleteCommunities(communityIds: string[]): Promise<void> {
  const svc = service();
  if (communityIds.length === 0) return;
  await svc.from("communities").delete().in("id", communityIds);
}

/**
 * Sort two UUIDs in canonical order for message_threads
 * (participant_a < participant_b, per the CHECK constraint).
 */
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
