/**
 * Backfill: mirror ITC map goals into quarterly_goals for maps whose
 * link never got created.
 *
 * Problem: syncItcGoalToTracker (src/lib/itc/tracker-link.ts) creates a
 * quarterly_goals row + writes itc_maps.quarterly_goal_id every time an
 * ITC coachee saves their goal — but it only runs on save, and only
 * when the participant already has a user_id link. Maps whose goal was
 * saved before the participant → user bridge existed (or before
 * syncItcGoalToTracker itself existed) are orphaned: the map has an
 * improvement_goal but no mirror row, so /goals shows "No active ITC
 * map" even though /itc shows the map.
 *
 * This script does what syncItcGoalToTracker would have done, for
 * every eligible orphan:
 *   - itc_maps.improvement_goal IS NOT NULL
 *   - itc_maps.quarterly_goal_id IS NULL
 *   - itc_maps.participant_id → itc_participants.user_id IS NOT NULL
 *
 * Insert quarterly_goals (source='itc', status='active', current
 * quarter, desired_end_state = map.improvement_goal), then update the
 * map to link back.
 *
 * Usage:
 *
 *   npm run backfill:itc-goals               (dry run, no writes)
 *   npm run backfill:itc-goals -- --apply    (writes to prod)
 *
 * Idempotent: the WHERE quarterly_goal_id IS NULL filter means re-runs
 * skip already-backfilled maps.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const REST_URL = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
    process.exit(1);
  }
  return `${url}/rest/v1`;
})();
const SVC_KEY = (() => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  return key;
})();

const APPLY = process.argv.includes("--apply");

async function pgGet<T>(path: string): Promise<T> {
  const res = await fetch(`${REST_URL}/${path}`, {
    headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path}: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function pgPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${REST_URL}/${path}`, {
    method: "POST",
    headers: {
      apikey: SVC_KEY,
      Authorization: `Bearer ${SVC_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`POST ${path}: ${res.status} ${bodyText.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function pgPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${REST_URL}/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SVC_KEY,
      Authorization: `Bearer ${SVC_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`PATCH ${path}: ${res.status} ${bodyText.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

type OrphanMap = {
  id: string;
  participant_id: string;
  pillar_code: string;
  improvement_goal: string;
  status: string;
  current_stage: string;
};

type Participant = {
  id: string;
  email: string;
  user_id: string | null;
};

/** Match src/lib/scoring/quarters.ts::getCurrentQuarter. */
function currentQuarterStartIso(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIdx = now.getUTCMonth();
  const startMonth = Math.floor(monthIdx / 3) * 3;
  const mm = String(startMonth + 1).padStart(2, "0");
  return `${year}-${mm}-01`;
}

async function main(): Promise<void> {
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes)\n");

  // Fetch orphan maps: has a goal, no mirror link.
  const orphans = await pgGet<OrphanMap[]>(
    "itc_maps?select=id,participant_id,pillar_code,improvement_goal,status,current_stage" +
      "&improvement_goal=not.is.null&quarterly_goal_id=is.null&order=updated_at.desc",
  );

  console.log(`Orphan maps found: ${orphans.length}`);
  if (orphans.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Fetch each unique participant so we know which are bridged to a user.
  const participantIds = Array.from(new Set(orphans.map((m) => m.participant_id)));
  const participantList = await pgGet<Participant[]>(
    `itc_participants?select=id,email,user_id&id=in.(${participantIds.join(",")})`,
  );
  const participantById = new Map(participantList.map((p) => [p.id, p]));

  const quarterStart = currentQuarterStartIso();
  console.log(`Current quarter: ${quarterStart}\n`);

  let planned = 0;
  const skipped: Array<{ mapId: string; reason: string }> = [];

  for (const map of orphans) {
    const p = participantById.get(map.participant_id);
    if (!p) {
      skipped.push({ mapId: map.id, reason: "participant not found" });
      continue;
    }
    if (!p.user_id) {
      skipped.push({
        mapId: map.id,
        reason: `participant ${p.email} not linked to a user`,
      });
      continue;
    }
    planned += 1;
    console.log(
      `  · map ${map.id.slice(0, 8)} · ${p.email} · pillar=${map.pillar_code} · stage=${map.current_stage}`,
    );
    console.log(`    goal: ${map.improvement_goal.slice(0, 100)}`);

    if (!APPLY) continue;

    // Insert quarterly_goal (source='itc' claims the reserved 3rd slot
    // per split-cap trigger; won't fight the user's 2 manual slots).
    const inserted = await pgPost<Array<{ id: string }>>("quarterly_goals", {
      user_id: p.user_id,
      quarter_start: quarterStart,
      focus_area: map.pillar_code,
      desired_end_state: map.improvement_goal,
      status: "active",
      source: "itc",
    });
    const goalId = inserted[0]?.id;
    if (!goalId) {
      console.log(`    ! insert returned no id — skipping link`);
      continue;
    }
    // Link map back to the new goal.
    await pgPatch(`itc_maps?id=eq.${map.id}`, { quarterly_goal_id: goalId });
    console.log(`    ✓ linked to goal ${goalId.slice(0, 8)}`);
  }

  console.log(`\nPlanned: ${planned}`);
  console.log(`Skipped: ${skipped.length}`);
  for (const s of skipped) {
    console.log(`  · ${s.mapId.slice(0, 8)} — ${s.reason}`);
  }
  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
