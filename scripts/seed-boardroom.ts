/**
 * scripts/seed-boardroom.ts
 *
 * Seeds a month of realistic activity for 5 guys in the Business Owner
 * Brotherhood. Idempotent — re-runnable without duplication.
 *
 * Usage: `npm run seed:boardroom` (see package.json).
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { addDays, format, startOfWeek } from "date-fns";

loadEnv({ path: ".env.local" });
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COMMUNITY_SLUG = "dad-edge-business-owner-brotherhood";
const DEFAULT_PASSWORD = "Boardroom2026!";
const DAYS_OF_HISTORY = 28;

type Seed = {
  first_name: string;
  last_name: string;
  email: string;
  timezone: string;
  goals: { focus_area: PillarCode; description: string }[];
  missionTemplates: MissionTemplate[];
  checkinAffinity: Partial<Record<PillarCode, number>>; // 0..1 completion likelihood per pillar
};

type PillarCode = "B" | "R" | "A" | "V" | "E" | "M" | "N";

type MissionTemplate = {
  goalIdx: 0 | 1 | null; // which goal it serves; null = "other"
  pillar: PillarCode;
  description: string;
  quality: number; // 0-10
  weekOffsetsBack: number[]; // e.g. [0,1,2,3] means also this-week and 3 previous weeks
  weekday: number; // 0=Mon..6=Sun (mission date within its week)
};

const SEEDS: Seed[] = [
  {
    first_name: "Larry",
    last_name: "",
    email: "larry@boardroom.dadedge.local",
    timezone: "America/Chicago",
    goals: [
      { focus_area: "A", description: "Add $15K in monthly recurring revenue by end of quarter." },
      { focus_area: "V", description: "Deadlift 400 by end of quarter." },
    ],
    checkinAffinity: { B: 0.9, R: 0.85, A: 0.95, V: 0.9, E: 0.7, M: 0.95, N: 0.8 },
    missionTemplates: [
      { goalIdx: 0, pillar: "A", description: "Send 15 sales outreach emails Monday before 9am.", quality: 10, weekOffsetsBack: [0, 1, 2, 3], weekday: 0 },
      { goalIdx: 0, pillar: "A", description: "Publish the pricing page revision by Friday end of day.", quality: 9, weekOffsetsBack: [1, 3], weekday: 4 },
      { goalIdx: 1, pillar: "V", description: "Deadlift 3x5 at 335 Wednesday morning before 7am.", quality: 10, weekOffsetsBack: [0, 1, 2, 3], weekday: 2 },
      { goalIdx: 1, pillar: "V", description: "Cold plunge four minutes every day this week.", quality: 8, weekOffsetsBack: [1, 2], weekday: 5 },
      { goalIdx: null, pillar: "B", description: "Take my wife on a date night Thursday, phone in the car.", quality: 10, weekOffsetsBack: [0, 2], weekday: 3 },
    ],
  },
  {
    first_name: "Marc",
    last_name: "",
    email: "marc@boardroom.dadedge.local",
    timezone: "America/Denver",
    goals: [
      { focus_area: "R", description: "Read to my kids every single night this quarter." },
      { focus_area: "A", description: "Ship the v2 launch by end of quarter." },
    ],
    checkinAffinity: { B: 0.85, R: 0.95, A: 0.85, V: 0.75, E: 0.7, M: 0.75, N: 0.8 },
    missionTemplates: [
      { goalIdx: 0, pillar: "R", description: "Read to the kids every night this week, no exceptions.", quality: 10, weekOffsetsBack: [0, 1, 2, 3], weekday: 6 },
      { goalIdx: 0, pillar: "R", description: "Take my son to breakfast Saturday, no siblings, no phone.", quality: 10, weekOffsetsBack: [1, 2], weekday: 5 },
      { goalIdx: 1, pillar: "A", description: "Merge the payments PR by Wednesday end of day.", quality: 9, weekOffsetsBack: [0, 1, 3], weekday: 2 },
      { goalIdx: 1, pillar: "A", description: "Record and publish the launch demo video by Friday noon.", quality: 8, weekOffsetsBack: [2, 3], weekday: 4 },
      { goalIdx: null, pillar: "V", description: "Cook dinner from scratch Sunday — no takeout.", quality: 9, weekOffsetsBack: [0, 2], weekday: 6 },
    ],
  },
  {
    first_name: "Al",
    last_name: "Whitney",
    email: "al.whitney@boardroom.dadedge.local",
    timezone: "America/New_York",
    goals: [
      { focus_area: "A", description: "Close two new $50K clients by end of quarter." },
      { focus_area: "B", description: "Weekly date night with my wife, every week this quarter." },
    ],
    checkinAffinity: { B: 0.95, R: 0.9, A: 0.9, V: 0.8, E: 0.7, M: 0.85, N: 0.8 },
    missionTemplates: [
      { goalIdx: 0, pillar: "A", description: "Book three discovery calls by Wednesday end of day.", quality: 10, weekOffsetsBack: [0, 1, 2, 3], weekday: 2 },
      { goalIdx: 0, pillar: "A", description: "Send the enterprise proposal by Thursday noon.", quality: 9, weekOffsetsBack: [1, 3], weekday: 3 },
      { goalIdx: 1, pillar: "B", description: "Take my wife out to dinner Thursday, phone in the car.", quality: 10, weekOffsetsBack: [0, 1, 2, 3], weekday: 3 },
      { goalIdx: 1, pillar: "B", description: "Sit with my wife Sunday morning for 30 minutes, no phone.", quality: 9, weekOffsetsBack: [1, 2], weekday: 6 },
      { goalIdx: null, pillar: "M", description: "Run 5k Monday, Wednesday, Friday before 7am.", quality: 8, weekOffsetsBack: [0, 2, 3], weekday: 0 },
    ],
  },
  {
    first_name: "John",
    last_name: "Young",
    email: "john.young@boardroom.dadedge.local",
    timezone: "America/Los_Angeles",
    goals: [
      { focus_area: "V", description: "Sub-6:30 mile by end of quarter." },
      { focus_area: "A", description: "Hire and onboard a second sales rep by end of quarter." },
    ],
    checkinAffinity: { B: 0.8, R: 0.85, A: 0.9, V: 0.95, E: 0.75, M: 0.95, N: 0.85 },
    missionTemplates: [
      { goalIdx: 0, pillar: "V", description: "Track 4-min intervals at the track Tuesday before 6am.", quality: 10, weekOffsetsBack: [0, 1, 2, 3], weekday: 1 },
      { goalIdx: 0, pillar: "V", description: "Long run 8 miles Saturday morning, target 7:30 pace.", quality: 9, weekOffsetsBack: [0, 2, 3], weekday: 5 },
      { goalIdx: 1, pillar: "A", description: "Post the sales rep job on LinkedIn by Monday end of day.", quality: 10, weekOffsetsBack: [3], weekday: 0 },
      { goalIdx: 1, pillar: "A", description: "Interview two candidates by Thursday.", quality: 9, weekOffsetsBack: [2], weekday: 3 },
      { goalIdx: null, pillar: "N", description: "Call one mentor Friday afternoon, no agenda.", quality: 8, weekOffsetsBack: [0, 1, 3], weekday: 4 },
    ],
  },
];

const REFLECTIONS: { wins: string; learnings: string }[] = [
  {
    wins: "Made the sales calls I said I would. Didn't hide.",
    learnings: "Waited too long to prep. Block time on the calendar before Monday next time.",
  },
  {
    wins: "Full week of workouts. Deadlift PR by 10 pounds.",
    learnings: "Sleep on Thursday was garbage — cut the Wednesday whiskey.",
  },
  {
    wins: "Date night went well. Actually asked questions and listened.",
    learnings: "I kept checking my watch. Put the watch in the drawer next time.",
  },
  {
    wins: "Kids read with me every night this week.",
    learnings: "Bedtime is easier when I start at 7:30 instead of 8.",
  },
  {
    wins: "Hard conversation with my business partner went better than I feared.",
    learnings: "I'd been avoiding it for a month. The dread was worse than the talk.",
  },
  {
    wins: "Cooked Sunday dinner from scratch. Kids helped.",
    learnings: "Prep the mise en place Saturday night — Sunday afternoon feels rushed.",
  },
  {
    wins: "Sent the proposal Thursday like I said I would.",
    learnings: "I overwrote it. Should have shipped the shorter version.",
  },
  {
    wins: "Called Dad. Hadn't in three weeks.",
    learnings: "Put a recurring calendar block — I always forget.",
  },
  {
    wins: "Cold plunge every morning. Head feels clearer.",
    learnings: "The first minute is the whole thing. Get in faster.",
  },
  {
    wins: "Didn't check email until 9am. Best focus day in weeks.",
    learnings: "The urge is in my hand, not my head. Phone in another room.",
  },
];

async function main() {
  console.log("Seeding Boardroom…");

  // 1. Find community.
  const { data: community, error: cErr } = await svc
    .from("communities")
    .select("id, name")
    .eq("slug", COMMUNITY_SLUG)
    .maybeSingle();
  if (cErr || !community) {
    console.error(
      `Community with slug "${COMMUNITY_SLUG}" not found. Create it first — see the SQL Jason ran earlier.`,
    );
    process.exit(1);
  }
  const communityId = community.id as string;
  console.log(`  · community: ${community.name} (${communityId})`);

  // Compute date range.
  const today = new Date();
  const startWindow = addDays(today, -DAYS_OF_HISTORY);

  // Current quarter start.
  const qStart = format(
    new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1),
    "yyyy-MM-dd",
  );

  let totalCheckins = 0;
  let totalMissions = 0;
  let totalReflections = 0;

  for (const seed of SEEDS) {
    console.log(`\n  · ${seed.first_name} ${seed.last_name}`);
    const userId = await ensureAuthUser(seed);

    await svc
      .from("users")
      .update({
        first_name: seed.first_name,
        last_name: seed.last_name || null,
        timezone: seed.timezone,
        subscription_status: "comped",
        subscription_source: "manual",
        onboarding_step: 7,
      })
      .eq("id", userId);

    await upsertMembership(userId, communityId);
    const goalIds = await upsertGoals(userId, qStart, seed.goals);
    const missionCount = await upsertMissions(
      userId,
      communityId,
      seed.missionTemplates,
      goalIds,
      today,
    );
    const checkinCount = await upsertCheckins(userId, seed, startWindow, today);
    const reflectionCount = await upsertReflections(userId, startWindow, today);

    totalMissions += missionCount;
    totalCheckins += checkinCount;
    totalReflections += reflectionCount;
    console.log(
      `      missions: ${missionCount}, check-ins: ${checkinCount}, reflections: ${reflectionCount}`,
    );
  }

  console.log(
    `\nDone. Total — missions: ${totalMissions}, check-ins: ${totalCheckins}, reflections: ${totalReflections}.`,
  );
  console.log(`Login for any of them: email above · password: ${DEFAULT_PASSWORD}`);
}

async function ensureAuthUser(seed: Seed): Promise<string> {
  // Look up existing auth user by email.
  // Supabase Admin API doesn't expose a direct by-email endpoint; we page listUsers.
  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  const users = (list?.users ?? []) as { id: string; email?: string | null }[];
  const existing = users.find((u) => (u.email ?? "").toLowerCase() === seed.email);
  if (existing) return existing.id;

  const { data: created, error } = await svc.auth.admin.createUser({
    email: seed.email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: seed.first_name, last_name: seed.last_name },
  });
  if (error || !created.user) throw new Error(`auth.createUser failed: ${error?.message}`);
  return created.user.id;
}

async function upsertMembership(userId: string, communityId: string) {
  const { data: existing } = await svc
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("community_id", communityId)
    .maybeSingle();
  if (existing) {
    await svc
      .from("memberships")
      .update({ role: "member", status: "active", deactivated_at: null })
      .eq("id", (existing as { id: string }).id);
    return;
  }
  const { error } = await svc.from("memberships").insert({
    user_id: userId,
    community_id: communityId,
    role: "member",
    status: "active",
  });
  if (error) throw new Error(`membership insert failed: ${error.message}`);
}

async function upsertGoals(
  userId: string,
  quarterStart: string,
  goals: Seed["goals"],
): Promise<string[]> {
  const ids: string[] = [];
  for (const g of goals) {
    const { data: existing } = await svc
      .from("quarterly_goals")
      .select("id")
      .eq("user_id", userId)
      .eq("quarter_start", quarterStart)
      .eq("description", g.description)
      .maybeSingle();
    if (existing) {
      ids.push((existing as { id: string }).id);
      continue;
    }
    const { data: created, error } = await svc
      .from("quarterly_goals")
      .insert({
        user_id: userId,
        quarter_start: quarterStart,
        focus_area: g.focus_area,
        description: g.description,
        status: "active",
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`goal insert failed: ${error?.message}`);
    ids.push((created as { id: string }).id);
  }
  return ids;
}

async function upsertMissions(
  userId: string,
  communityId: string,
  templates: MissionTemplate[],
  goalIds: string[],
  today: Date,
): Promise<number> {
  let count = 0;
  for (const t of templates) {
    for (const weeksBack of t.weekOffsetsBack) {
      const weekMonday = startOfWeek(addDays(today, -7 * weeksBack), { weekStartsOn: 1 });
      const targetDate = addDays(weekMonday, t.weekday);
      const targetISO = format(targetDate, "yyyy-MM-dd");
      const goalId = t.goalIdx === null ? null : goalIds[t.goalIdx] ?? null;

      // Dedupe on natural key: (user, target_date, description).
      const { data: existing } = await svc
        .from("missions")
        .select("id")
        .eq("user_id", userId)
        .eq("target_date", targetISO)
        .eq("description", t.description)
        .maybeSingle();
      if (existing) continue;

      const isPast = targetDate < today;
      const roll = Math.random();
      let status: "planned" | "completed" | "missed" = "planned";
      let completed_at: string | null = null;
      let completed_late = false;
      if (isPast) {
        if (roll < 0.85) {
          status = "completed";
          const completeDay = addDays(targetDate, roll < 0.75 ? 0 : 1);
          completed_at = completeDay.toISOString();
          completed_late = completeDay > targetDate;
        } else {
          status = "missed";
        }
      }

      // Deterministic auto-exemplar: score >= 9 AND on-time completion.
      const isExemplar = status === "completed" && !completed_late && t.quality >= 9;

      const { error } = await svc.from("missions").insert({
        user_id: userId,
        community_id: communityId,
        quarterly_goal_id: goalId,
        pillar_code: t.pillar,
        description: t.description,
        target_date: targetISO,
        status,
        completed_at,
        completed_late,
        created_by: "user",
        quality_score: t.quality,
        is_exemplar: isExemplar,
        exemplar_text: isExemplar ? t.description : null,
      });
      if (error) {
        console.warn(`      mission insert warning (${targetISO}): ${error.message}`);
        continue;
      }
      count += 1;
    }
  }
  return count;
}

async function upsertCheckins(
  userId: string,
  seed: Seed,
  startWindow: Date,
  today: Date,
): Promise<number> {
  const rows: {
    user_id: string;
    date: string;
    pillar_code: PillarCode;
    value: 0 | 1;
  }[] = [];
  const affinity = seed.checkinAffinity;
  for (let d = 0; d <= DAYS_OF_HISTORY; d++) {
    const day = addDays(startWindow, d);
    if (day > today) break;
    const dateISO = format(day, "yyyy-MM-dd");
    for (const p of ["B", "R", "A", "V", "E", "M", "N"] as PillarCode[]) {
      const chance = affinity[p] ?? 0.7;
      if (Math.random() < chance) rows.push({ user_id: userId, date: dateISO, pillar_code: p, value: 1 });
    }
  }
  if (rows.length === 0) return 0;
  // Chunk to avoid oversized payloads.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error, count } = await svc
      .from("daily_checkins")
      .upsert(slice, { onConflict: "user_id,date,pillar_code", count: "exact" });
    if (error) {
      console.warn(`      checkin upsert warning: ${error.message}`);
      continue;
    }
    inserted += count ?? slice.length;
  }
  return inserted;
}

async function upsertReflections(
  userId: string,
  startWindow: Date,
  today: Date,
): Promise<number> {
  // Roughly every 3 days, add a reflection.
  let count = 0;
  for (let d = 0; d <= DAYS_OF_HISTORY; d += 3) {
    const day = addDays(startWindow, d);
    if (day > today) break;
    const dateISO = format(day, "yyyy-MM-dd");
    const template = REFLECTIONS[Math.floor(Math.random() * REFLECTIONS.length)];
    const { error } = await svc.from("daily_reflections").upsert(
      {
        user_id: userId,
        date: dateISO,
        wins: template.wins,
        learnings: template.learnings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );
    if (!error) count += 1;
  }
  return count;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
