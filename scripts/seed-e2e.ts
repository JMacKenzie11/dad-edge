/**
 * Browser-test fixtures on the DEV database: one account per role, the data
 * the smoke specs look for, and nothing else. Safe to rerun; every run puts
 * the same state back (docs/e2e.md).
 *
 *   npm run seed:e2e
 *
 * Accounts (all @braveman.test, so mail to them goes nowhere):
 *   member   community member with a goal and two Bond missions this week
 *   leader   leader of the same community
 *   admin    platform admin (backstage + member view)
 *   coachee  member with improvement-map (ITC) access and no map yet
 *
 * Passwords come from E2E_<ROLE>_PASSWORD in .env.local. When one is
 * missing, this generates it, sets it on the account, and prints the lines
 * to add to .env.local.
 *
 * Refuses anything but the dev database, by project id (scripts/lib/target.ts).
 */
import { randomBytes } from "node:crypto";
import { addDays, format, startOfWeek } from "date-fns";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry";
import { assertDevTarget } from "./lib/target";

export const E2E_COMMUNITY_SLUG = "e2e-basecamp";
export const E2E_COURSE_SLUG = "e2e-course";
export const E2E_ROLES = ["member", "leader", "admin", "coachee"] as const;
export type E2ERole = (typeof E2E_ROLES)[number];

export function e2eEmail(role: E2ERole): string {
  return `e2e-${role}@braveman.test`;
}

/** Monday..Sunday of the week containing `now`, as yyyy-MM-dd (UTC). */
export function thisWeek(now = new Date()): string[] {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = startOfWeek(utc, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), "yyyy-MM-dd"));
}

async function findUserId(svc: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function main(): Promise<void> {
  config({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  assertDevTarget(url);
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Community
  let { data: community } = await svc.from("communities").select("id").eq("slug", E2E_COMMUNITY_SLUG).maybeSingle();
  if (!community) {
    const ins = await svc.from("communities").insert({ name: "E2E Basecamp", slug: E2E_COMMUNITY_SLUG }).select("id").single();
    if (ins.error) throw ins.error;
    community = ins.data;
  }
  const communityId = (community as { id: string }).id;

  // Accounts
  const printed: string[] = [];
  const ids = {} as Record<E2ERole, string>;
  for (const role of E2E_ROLES) {
    const email = e2eEmail(role);
    const pwVar = `E2E_${role.toUpperCase()}_PASSWORD`;
    let password = process.env[pwVar];
    if (!password) {
      password = `E2e-${randomBytes(12).toString("base64url")}`;
      printed.push(`E2E_${role.toUpperCase()}_EMAIL=${email}`, `${pwVar}=${password}`);
    }
    let id = await findUserId(svc, email);
    if (id) {
      const up = await svc.auth.admin.updateUserById(id, { password, email_confirm: true });
      if (up.error) throw up.error;
    } else {
      const created = await svc.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      id = created.data.user!.id;
    }
    ids[role] = id;
    const profile = await svc
      .from("users")
      .update({
        first_name: `E2E ${role[0].toUpperCase()}${role.slice(1)}`,
        last_name: "Tester",
        subscription_status: "comped",
        onboarding_step: 6,
        is_platform_admin: role === "admin",
        is_admin_only: false,
        itc_access: role === "coachee",
      })
      .eq("id", id);
    if (profile.error) throw profile.error;
  }

  // Memberships: member, leader and coachee in the e2e community. The
  // admin is added to every community automatically.
  for (const role of ["member", "leader", "coachee"] as const) {
    const { error } = await svc
      .from("memberships")
      .upsert(
        { user_id: ids[role], community_id: communityId, role: role === "leader" ? "leader" : "member", status: "active" },
        { onConflict: "user_id,community_id" },
      );
    if (error) throw error;
  }

  // Member's week: one goal, exactly two Bond missions, nothing else.
  const week = thisWeek();
  await svc.from("missions").delete().eq("user_id", ids.member).gte("target_date", week[0]).lte("target_date", week[6]);
  await svc.from("quarterly_goals").delete().eq("user_id", ids.member).eq("source", "user");
  const q = new Date();
  const quarterStart = format(new Date(Date.UTC(q.getUTCFullYear(), Math.floor(q.getUTCMonth() / 3) * 3, 1)), "yyyy-MM-dd");
  const goal = await svc.from("quarterly_goals").insert({
    user_id: ids.member,
    quarter_start: quarterStart,
    focus_area: "V",
    current_state: "Lifting twice a week.",
    desired_end_state: "Lift four times a week by the end of the quarter.",
    status: "active",
    source: "user",
  });
  if (goal.error) throw goal.error;
  for (const [i, text] of ["Call her at lunch on Tuesday", "Book Saturday date night"].entries()) {
    const day = week[1 + i];
    const m = await svc.from("missions").insert({
      user_id: ids.member,
      community_id: communityId,
      description: text,
      pillar_code: "B",
      target_date: day,
      target_dates: [day],
      created_by: "user",
    });
    if (m.error) throw m.error;
  }

  // A published course every community can see.
  let { data: course } = await svc.from("courses").select("id").eq("slug", E2E_COURSE_SLUG).maybeSingle();
  if (!course) {
    const ins = await svc
      .from("courses")
      .insert({ title: "E2E Course", slug: E2E_COURSE_SLUG, is_published: true, sort_order: 99 })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    course = ins.data;
    const courseId = (course as { id: string }).id;
    await svc.from("lessons").insert([
      { course_id: courseId, title: "E2E lesson one", sort_order: 0 },
      { course_id: courseId, title: "E2E lesson two", sort_order: 1 },
    ]);
  } else {
    await svc.from("courses").update({ is_published: true }).eq("id", (course as { id: string }).id);
  }

  console.log(`[seed:e2e] ready on ${url}: community ${E2E_COMMUNITY_SLUG}, ${E2E_ROLES.length} accounts, course ${E2E_COURSE_SLUG}.`);
  if (printed.length) {
    console.log("\nAdd these to .env.local (new passwords were set on the accounts):\n");
    console.log(printed.join("\n"));
  }
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
