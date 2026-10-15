/**
 * Missions and Goals Restructure: existing-data report (Part 2, §2.3).
 *
 * The new rules (two missions per week in each of B/R/A/V/E with no goal,
 * five goal-linked missions per week in total, goals only on B/R/A/V/E)
 * apply to NEW missions and goals only. This script reads every existing
 * row and reports what the new rules would have said about it, so Jason
 * can review before any trigger changes. It writes nothing.
 *
 *   npm run migrate:mission-structure                 (report only)
 *   npm run migrate:mission-structure -- --json       (machine-readable)
 *   npm run migrate:mission-structure -- --include-test-accounts
 *
 * What it reports:
 *   1. Missions on Movement, Action or Network. Kept exactly as they are:
 *      they stay in history and keep counting in past scores. New ones
 *      can't be created once the new trigger ships.
 *   2. Weeks where a man already has more than two no-goal missions in one
 *      domain, or more than five goal missions. Grandfathered: the cap is
 *      checked only when a mission is added or moved into a week.
 *   3. Active goals on Movement, Action or Network. Listed for a per-goal
 *      decision (likely Network → Amplify, as Larry suggested). Not changed.
 *   4. In-progress ITC maps on those pillars, since an ITC goal mirrors its
 *      map's pillar and the ITC picker gets the same restriction.
 *   5. Goal missions whose pillar differs from their goal's, because goal
 *      missions inherit the goal's pillar from now on. Not changed.
 *   6. Men with three or more active goals this quarter (allowed now; shown
 *      so the soft "one or two" note can be sanity-checked).
 *   7. No-goal missions saved since the slot grid shipped (2026-08-31). That
 *      grid's "BRAVE MAN MISSIONS" section never asked for a pillar and
 *      stamped every one Bond (weekly-planner.tsx), so their pillar is a
 *      placeholder, not a choice. The new page sorts no-goal missions into
 *      domain rows by pillar, which makes this visible.
 *
 * Week boundaries match the existing trigger: date_trunc('week',
 * target_date), i.e. Monday to Sunday on the mission's last target day.
 * Rolled-over and abandoned missions don't count, same as today.
 *
 * Test accounts (it+…@braveman.test, [IT-TEST] communities) are left out
 * of the counts unless --include-test-accounts is passed; how many were
 * skipped is printed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const includeTest = args.includes("--include-test-accounts");

// Read-only: no dev-target guard, so the report can be run against
// production. It never writes (--apply refuses).
let svc: SupabaseClient;

function connect(): void {
  if (args.includes("--apply")) {
    console.error(
      "[migrate:mission-structure] There's nothing to apply yet. This is the review step: no rows change until Jason has read the report and decided each listed goal.",
    );
    process.exit(1);
  }
  svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const DOMAINS = ["B", "R", "A", "V", "E"] as const;
const RETIRED = ["M", "A2", "N"] as const;
const LABEL: Record<string, string> = {
  B: "Bond",
  R: "Raise",
  A: "Amplify",
  V: "Vitality",
  E: "Enjoyment",
  M: "Movement",
  A2: "Action",
  N: "Network",
};
const DOMAIN_CAP = 2;
const GOAL_CAP = 5;

type Mission = {
  id: string;
  user_id: string;
  pillar_code: string;
  quarterly_goal_id: string | null;
  target_date: string;
  status: string;
  created_by: string;
  legacy_import: boolean | null;
  created_at: string;
};
type Goal = {
  id: string;
  user_id: string;
  quarter_start: string;
  focus_area: string;
  desired_end_state: string;
  status: string;
  source: string;
};
type User = { id: string; email: string; first_name: string | null; last_name: string | null };

async function all<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Same as Postgres date_trunc('week', d): the Monday on or before d. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function currentQuarterStart(today = new Date()): string {
  const m = Math.floor(today.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(today.getUTCFullYear(), m, 1)).toISOString().slice(0, 10);
}

async function main() {
  connect();
  const [users, missions, goals, maps, memberships, communities] = await Promise.all([
    all<User>("users", "id, email, first_name, last_name"),
    all<Mission>("missions", "id, user_id, pillar_code, quarterly_goal_id, target_date, status, created_by, legacy_import, created_at"),
    all<Goal>("quarterly_goals", "id, user_id, quarter_start, focus_area, desired_end_state, status, source"),
    all<{ id: string; user_id: string | null; pillar_code: string; status: string; current_stage: string; quarterly_goal_id: string | null }>(
      "itc_maps",
      "id, user_id, pillar_code, status, current_stage, quarterly_goal_id",
    ),
    all<{ user_id: string; community_id: string }>("memberships", "user_id, community_id"),
    all<{ id: string; name: string }>("communities", "id, name"),
  ]);

  const testCommunities = new Set(communities.filter((c) => c.name.startsWith("[IT-TEST]")).map((c) => c.id));
  const testUsers = new Set(
    users
      .filter(
        (u) =>
          /@braveman\.test$/i.test(u.email) ||
          memberships.some((m) => m.user_id === u.id && testCommunities.has(m.community_id)),
      )
      .map((u) => u.id),
  );
  const keep = (userId: string | null) => includeTest || !userId || !testUsers.has(userId);
  const userById = new Map(users.map((u) => [u.id, u]));
  const who = (id: string | null) => {
    const u = id ? userById.get(id) : undefined;
    if (!u) return "(unknown)";
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return name ? `${name} <${u.email}>` : u.email;
  };

  const realMissions = missions.filter((m) => keep(m.user_id));
  const realGoals = goals.filter((g) => keep(g.user_id));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const counted = (m: Mission) => m.status !== "rolled_over" && m.status !== "abandoned";

  // 1. Missions on retired pillars
  const retired = realMissions.filter((m) => (RETIRED as readonly string[]).includes(m.pillar_code));
  const retiredByPillar = Object.fromEntries(
    RETIRED.map((p) => {
      const rows = retired.filter((m) => m.pillar_code === p);
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      return [
        p,
        {
          total: rows.length,
          withGoal: rows.filter((r) => r.quarterly_goal_id).length,
          byStatus,
          men: new Set(rows.map((r) => r.user_id)).size,
          planned: rows.filter((r) => r.status === "planned").length,
        },
      ];
    }),
  );
  const today = new Date().toISOString().slice(0, 10);
  const thisWeek = weekStart(today);
  const retiredStillPlanned = retired
    .filter((m) => m.status === "planned" && m.target_date >= thisWeek)
    .map((m) => ({ id: m.id, man: who(m.user_id), pillar: LABEL[m.pillar_code], target_date: m.target_date, has_goal: Boolean(m.quarterly_goal_id) }));

  // 2. Over-cap weeks
  const domainBuckets = new Map<string, Mission[]>();
  const goalBuckets = new Map<string, Mission[]>();
  for (const m of realMissions.filter(counted)) {
    const wk = weekStart(m.target_date);
    if (m.quarterly_goal_id) {
      const k = `${m.user_id}|${wk}`;
      goalBuckets.set(k, [...(goalBuckets.get(k) ?? []), m]);
    } else if ((DOMAINS as readonly string[]).includes(m.pillar_code)) {
      const k = `${m.user_id}|${wk}|${m.pillar_code}`;
      domainBuckets.set(k, [...(domainBuckets.get(k) ?? []), m]);
    }
  }
  const overDomain = [...domainBuckets.entries()]
    .filter(([, rows]) => rows.length > DOMAIN_CAP)
    .map(([k, rows]) => {
      const [userId, week, pillar] = k.split("|");
      return { man: who(userId), user_id: userId, week, pillar: LABEL[pillar], missions: rows.length, current_or_future: week >= thisWeek };
    })
    .sort((a, b) => b.week.localeCompare(a.week));
  const overGoal = [...goalBuckets.entries()]
    .filter(([, rows]) => rows.length > GOAL_CAP)
    .map(([k, rows]) => {
      const [userId, week] = k.split("|");
      return { man: who(userId), user_id: userId, week, goal_missions: rows.length, current_or_future: week >= thisWeek };
    })
    .sort((a, b) => b.week.localeCompare(a.week));

  // 3. Active goals on retired pillars
  const goalsOnRetired = realGoals
    .filter((g) => (g.status === "active" || g.status === "needs_review") && (RETIRED as readonly string[]).includes(g.focus_area))
    .map((g) => ({
      goal_id: g.id,
      man: who(g.user_id),
      pillar: LABEL[g.focus_area],
      status: g.status,
      source: g.source,
      quarter_start: g.quarter_start,
      goal: g.desired_end_state.replace(/\s+/g, " ").slice(0, 160),
      linked_missions: missions.filter((m) => m.quarterly_goal_id === g.id).length,
      planned_missions_from_this_week: missions.filter((m) => m.quarterly_goal_id === g.id && m.status === "planned" && m.target_date >= thisWeek).length,
    }));

  // 4. In-progress ITC maps on retired pillars
  const mapsOnRetired = maps
    .filter((m) => m.status === "in_progress" && (RETIRED as readonly string[]).includes(m.pillar_code) && keep(m.user_id))
    .map((m) => ({ map_id: m.id, man: who(m.user_id), pillar: LABEL[m.pillar_code], stage: m.current_stage, goal_id: m.quarterly_goal_id }));

  // 5. Goal missions whose pillar differs from the goal's
  const pillarMismatch = realMissions.filter((m) => {
    if (!m.quarterly_goal_id) return false;
    const g = goalById.get(m.quarterly_goal_id);
    return g ? g.focus_area !== m.pillar_code : false;
  });

  // 6. Three or more active goals this quarter
  const q = currentQuarterStart();
  const activeThisQuarter = new Map<string, number>();
  for (const g of realGoals.filter((g) => g.status === "active" && g.quarter_start === q)) {
    activeThisQuarter.set(g.user_id, (activeThisQuarter.get(g.user_id) ?? 0) + 1);
  }
  const threePlus = [...activeThisQuarter.entries()].filter(([, n]) => n >= 3).map(([id, n]) => ({ man: who(id), active_goals: n }));

  // 7. Placeholder-Bond no-goal missions from the slot grid
  const SLOT_GRID_SHIPPED = "2026-08-31";
  const placeholderBond = realMissions.filter(
    (m) => !m.quarterly_goal_id && m.pillar_code === "B" && m.created_by === "user" && m.created_at >= SLOT_GRID_SHIPPED,
  );
  const placeholderByMan = new Map<string, number>();
  for (const m of placeholderBond) placeholderByMan.set(m.user_id, (placeholderByMan.get(m.user_id) ?? 0) + 1);
  const placeholderFromThisWeek = placeholderBond.filter((m) => m.target_date >= thisWeek && counted(m)).length;

  const report = {
    generated_at: new Date().toISOString(),
    this_week_starts: thisWeek,
    quarter_start: q,
    scope: {
      men_counted: users.filter((u) => keep(u.id)).length,
      test_accounts_skipped: includeTest ? 0 : testUsers.size,
      missions_counted: realMissions.length,
      goals_counted: realGoals.length,
    },
    retired_pillar_missions: { total: retired.length, byPillar: retiredByPillar, still_planned_from_this_week: retiredStillPlanned },
    over_cap_weeks: {
      domain: { weeks: overDomain.length, men: new Set(overDomain.map((r) => r.user_id)).size, current_or_future: overDomain.filter((r) => r.current_or_future).length, rows: overDomain },
      goal: { weeks: overGoal.length, men: new Set(overGoal.map((r) => r.user_id)).size, current_or_future: overGoal.filter((r) => r.current_or_future).length, rows: overGoal },
    },
    goals_on_retired_pillars: goalsOnRetired,
    itc_maps_on_retired_pillars: mapsOnRetired,
    goal_missions_with_different_pillar: { total: pillarMismatch.length, men: new Set(pillarMismatch.map((m) => m.user_id)).size },
    men_with_three_plus_active_goals: threePlus,
    slot_grid_placeholder_bond: {
      total: placeholderBond.length,
      from_this_week: placeholderFromThisWeek,
      by_man: [...placeholderByMan.entries()].map(([id, n]) => ({ man: who(id), missions: n })),
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const L: string[] = [];
  L.push("# Mission structure: existing-data report (dry run, nothing written)");
  L.push("");
  L.push(`Generated ${report.generated_at}. This week starts ${thisWeek}. Quarter starts ${q}.`);
  L.push(`Counted ${report.scope.men_counted} accounts, ${report.scope.missions_counted} missions, ${report.scope.goals_counted} goals. Skipped ${report.scope.test_accounts_skipped} test accounts.`);
  L.push("");
  L.push("## 1. Missions on Movement, Action, Network (kept as they are)");
  L.push(`${retired.length} missions in total.`);
  for (const p of RETIRED) {
    const r = retiredByPillar[p];
    L.push(`- ${LABEL[p]}: ${r.total} missions from ${r.men} men (${r.withGoal} linked to a goal). By status: ${Object.entries(r.byStatus).map(([s, n]) => `${s} ${n}`).join(", ") || "none"}.`);
  }
  L.push(`Still planned for this week or later: ${retiredStillPlanned.length}. These stay on his list and can be completed; he just can't add new ones on these pillars.`);
  for (const r of retiredStillPlanned) L.push(`  - ${r.man}: ${r.pillar}, ${r.target_date}${r.has_goal ? " (goal mission)" : ""}`);
  L.push("");
  L.push("## 2. Weeks already over the new caps (grandfathered)");
  L.push(`Domain (more than ${DOMAIN_CAP} no-goal missions in one pillar): ${overDomain.length} pillar-weeks across ${report.over_cap_weeks.domain.men} men; ${report.over_cap_weeks.domain.current_or_future} are this week or later.`);
  for (const r of overDomain.slice(0, 40)) L.push(`  - ${r.week} ${r.man}: ${r.missions} ${r.pillar}${r.current_or_future ? "  ← shows on the new missions page" : ""}`);
  if (overDomain.length > 40) L.push(`  - …and ${overDomain.length - 40} more (use --json for all).`);
  L.push(`Goal missions (more than ${GOAL_CAP} in a week across all goals): ${overGoal.length} weeks across ${report.over_cap_weeks.goal.men} men; ${report.over_cap_weeks.goal.current_or_future} are this week or later.`);
  for (const r of overGoal.slice(0, 40)) L.push(`  - ${r.week} ${r.man}: ${r.goal_missions} goal missions${r.current_or_future ? "  ← shows on the new missions page" : ""}`);
  L.push("");
  L.push("## 3. Active goals on Movement, Action, Network (your call, per goal)");
  L.push(`${goalsOnRetired.length} goals. Nothing changes until you decide each one.`);
  for (const g of goalsOnRetired) {
    L.push(`  - [${g.goal_id}] ${g.man} · ${g.pillar} · ${g.status} · ${g.source} · quarter ${g.quarter_start} · ${g.linked_missions} missions (${g.planned_missions_from_this_week} planned from this week)`);
    L.push(`    "${g.goal}"`);
  }
  L.push("");
  L.push("## 4. In-progress ITC maps on Movement, Action, Network");
  L.push(`${mapsOnRetired.length} maps.`);
  for (const m of mapsOnRetired) L.push(`  - [${m.map_id}] ${m.man} · ${m.pillar} · stage ${m.stage}${m.goal_id ? ` · goal ${m.goal_id}` : ""}`);
  L.push("");
  L.push("## 5. Goal missions whose pillar differs from their goal's");
  L.push(`${pillarMismatch.length} missions from ${report.goal_missions_with_different_pillar.men} men. Kept as they are; new goal missions take the goal's pillar.`);
  L.push("");
  L.push("## 6. Men with three or more active goals this quarter");
  L.push(threePlus.length === 0 ? "None." : threePlus.map((r) => `  - ${r.man}: ${r.active_goals}`).join("\n"));
  L.push("");
  L.push("## 7. No-goal missions stamped Bond by the slot grid (pillar never chosen)");
  L.push(`${placeholderBond.length} missions since ${SLOT_GRID_SHIPPED}; ${placeholderFromThisWeek} are this week or later. Most of section 2's Bond weeks are these.`);
  for (const r of report.slot_grid_placeholder_bond.by_man) L.push(`  - ${r.man}: ${r.missions}`);
  console.log(L.join("\n"));
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
