/**
 * Seed script: one test community, six fake members, four weeks of realistic data.
 * Idempotent by natural keys.
 *
 * Usage:
 *   cp .env.example .env.local  # fill in Supabase URL + service role
 *   npm run seed
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PILLARS, type PillarCode } from "../src/lib/pillars";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const COMMUNITY = {
  name: "The Basecamp",
  slug: "basecamp",
  timezone: "America/Chicago",
};

const MEMBERS = [
  { first: "Steve",  last: "W", email: "steve.w@example.com",  role: "leader" as const, profile: "grinder" as const },
  { first: "Tim",    last: "C", email: "tim.c@example.com",    role: "member" as const, profile: "steady"  as const },
  { first: "John",   last: "Y", email: "john.y@example.com",   role: "member" as const, profile: "cyclic"  as const },
  { first: "Parker", last: "B", email: "parker.b@example.com", role: "member" as const, profile: "steady"  as const },
  { first: "Mike",   last: "R", email: "mike.r@example.com",   role: "member" as const, profile: "slipping" as const },
  { first: "Dave",   last: "K", email: "dave.k@example.com",   role: "member" as const, profile: "returning" as const },
];

type Profile = (typeof MEMBERS)[number]["profile"];

function seedRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function fourWeeksBack(): { start: string; days: string[] } {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - dow - 21);
  const days: string[] = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return { start: monday.toISOString().slice(0, 10), days };
}

function targetForProfile(p: Profile, dayIndex: number) {
  // Returns per-pillar probability of a 1 on this day.
  const base: Record<Profile, number> = {
    grinder: 0.85,
    steady: 0.65,
    cyclic: 0.55,
    slipping: 0.35,
    returning: 0.5,
  };
  const week = Math.floor(dayIndex / 7);
  if (p === "slipping") return Math.max(0.15, base[p] - 0.05 * week);
  if (p === "returning") return Math.min(0.85, base[p] + 0.08 * week);
  if (p === "cyclic") return base[p] + (week % 2 === 0 ? 0.1 : -0.15);
  return base[p];
}

const MISSION_TEMPLATES: { pillar: PillarCode; text: string }[] = [
  { pillar: "B",  text: "Take Sarah on a date night." },
  { pillar: "B",  text: "Call Mom." },
  { pillar: "R",  text: "Read to the kids at bedtime." },
  { pillar: "R",  text: "Coach Jack's practice." },
  { pillar: "A",  text: "Review Q3 numbers with team." },
  { pillar: "A",  text: "Ship the landing page." },
  { pillar: "V",  text: "Deadlift PR: 405×3." },
  { pillar: "V",  text: "Run 5k under 25." },
  { pillar: "E",  text: "Study for 30 minutes." },
  { pillar: "M",  text: "Journal three pages." },
  { pillar: "N",  text: "Meet Chris for coffee." },
  { pillar: "N",  text: "Call the mentor." },
];

async function upsertCommunity() {
  const { data: existing } = await sb
    .from("communities")
    .select("id")
    .eq("slug", COMMUNITY.slug)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await sb
    .from("communities")
    .insert({ ...COMMUNITY })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function upsertUser(m: (typeof MEMBERS)[number]): Promise<string> {
  // Prefer auth admin API so the row is real. Fall back to public.users if not permitted.
  const { data: existingAuth } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = existingAuth?.users.find((u) => u.email === m.email);
  if (found) {
    await sb.from("users").upsert({
      id: found.id,
      email: m.email,
      first_name: m.first,
      last_name: m.last,
      subscription_status: "comped",
    });
    return found.id;
  }
  const { data, error } = await sb.auth.admin.createUser({
    email: m.email,
    email_confirm: true,
    user_metadata: { first_name: m.first, last_name: m.last, seeded: true },
  });
  if (error) throw error;
  await sb.from("users").upsert({
    id: data.user!.id,
    email: m.email,
    first_name: m.first,
    last_name: m.last,
    subscription_status: "comped",
  });
  return data.user!.id;
}

async function seedCheckins(userId: string, profile: Profile, days: string[], rng: () => number) {
  const rows: {
    user_id: string;
    date: string;
    pillar_code: PillarCode;
    value: 0 | 1;
  }[] = [];
  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    const p = targetForProfile(profile, i);
    for (const pillar of PILLARS) {
      // Roll for "logged?" (rarely skipped for grinders, sometimes skipped for slipping)
      const logProb = profile === "slipping" ? 0.75 : profile === "returning" ? 0.85 : 0.97;
      if (rng() > logProb) continue;
      const val: 0 | 1 = rng() < p ? 1 : 0;
      rows.push({ user_id: userId, date, pillar_code: pillar.code, value: val });
    }
  }
  // Chunk to keep payloads sane.
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const { error } = await sb
      .from("daily_checkins")
      .upsert(chunk, { onConflict: "user_id,date,pillar_code" });
    if (error) throw error;
  }
}

async function seedMissions(
  userId: string,
  communityId: string,
  profile: Profile,
  days: string[],
  rng: () => number,
) {
  // For each of the four weeks, drop 2-4 missions with mixed statuses.
  for (let w = 0; w < 4; w++) {
    const weekStart = days[w * 7];
    const count = profile === "grinder" ? 4 : profile === "slipping" ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const t = MISSION_TEMPLATES[Math.floor(rng() * MISSION_TEMPLATES.length)];
      const dayOffset = Math.floor(rng() * 7);
      const target = days[w * 7 + dayOffset];
      // Skip if in the future — Phase 1 seed only backfills past weeks.
      const isPast = target < days[days.length - 1];
      let status: "planned" | "completed" | "missed" = "planned";
      let completedLate = false;
      if (isPast) {
        const roll = rng();
        if (roll < 0.6) status = "completed";
        else if (roll < 0.85) status = "missed";
        else {
          status = "completed";
          completedLate = true;
        }
      }
      const desc = `${t.text}${w > 0 ? "" : ""}`;
      await sb.from("missions").insert({
        user_id: userId,
        community_id: communityId,
        pillar_code: t.pillar,
        description: desc,
        target_date: target,
        status,
        completed_at: status === "completed" ? new Date().toISOString() : null,
        completed_late: completedLate,
        created_by: "user",
        legacy_import: false,
      });
    }
    // Random quarterly goal for grinders / steady
    if (w === 0 && profile !== "slipping") {
      const focus: PillarCode = (["B", "V", "A", "R"] as PillarCode[])[Math.floor(rng() * 4)];
      await sb.from("quarterly_goals").upsert(
        {
          user_id: userId,
          focus_area: focus,
          description: "Weekly date + one big adventure per month.",
          quarter_start: quarterStart(weekStart),
          status: "active",
        },
      );
    }
  }
}

function quarterStart(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  const m = q * 3 + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

async function main() {
  console.log("Seeding BRAVE MAN OS test data…");
  const communityId = await upsertCommunity();
  console.log(` community: ${COMMUNITY.slug} → ${communityId}`);
  const { days } = fourWeeksBack();
  console.log(` window: ${days[0]} → ${days[days.length - 1]} (28 days)`);

  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i];
    const rng = seedRand(0xC0FFEE + i * 31);
    const userId = await upsertUser(m);
    await sb.from("memberships").upsert(
      {
        user_id: userId,
        community_id: communityId,
        role: m.role,
        status: "active",
      },
      { onConflict: "user_id,community_id" },
    );
    console.log(` member: ${m.first} ${m.last} (${m.profile}) → ${userId}`);
    await seedCheckins(userId, m.profile, days, rng);
    await seedMissions(userId, communityId, m.profile, days, rng);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
