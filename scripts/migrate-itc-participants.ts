/**
 * ITC participant migration — Checkpoints E (dry-run) and F (apply)
 * of the auth-phase spec.
 *
 * For each itc_participants row, match to users by email
 * (case-insensitive). When matched, set itc_maps.user_id for every
 * map owned by that participant. When unmatched, list the participant
 * as "needs manual account creation" — do NOT auto-create the user.
 * Community assignment is a decision, not an inference; the correct
 * path is to create the account via /admin/users (with the intended
 * community + subscription status) and re-run the script.
 *
 * Data ownership:
 *   - itc_maps.participant_id stays on the row unchanged as historical
 *     reference.
 *   - itc_maps.user_id becomes the new ownership source of truth for
 *     the RLS + query paths that Checkpoint F wires up.
 *   - Child rows (itc_behaviors, itc_worries, itc_commitments,
 *     itc_assumptions, itc_tests, itc_test_results, itc_messages)
 *     cascade from map_id and need no schema or data touch.
 *
 * Usage:
 *
 *   npm run migrate:itc -- --dry-run    (Checkpoint E — required)
 *   npm run migrate:itc -- --apply      (Checkpoint F — requires prior --dry-run + explicit approval)
 *
 * Idempotent: running twice produces no duplicate links (a map whose
 * user_id is already set is a no-op) and no errors (already-mapped
 * users still resolve cleanly). Safe to re-run after creating a new
 * account for a previously-unmatched participant.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

/**
 * Direct REST client for PostgREST. Sidesteps supabase-js because that
 * library did local JWT time validation which fails in any environment
 * where the machine clock is ahead of the service-role key's `iat`.
 * Raw fetch with the service role key as bearer + apikey headers is
 * the same wire protocol PostgREST speaks; nothing lost, plus this
 * script runs in any environment with network access.
 */
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

async function pgGet<T>(path: string): Promise<T> {
  const res = await fetch(`${REST_URL}/${path}`, {
    headers: {
      apikey: SVC_KEY,
      Authorization: `Bearer ${SVC_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path}: ${res.status} ${body.slice(0, 300)}`);
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
    const body = await res.text();
    throw new Error(`PATCH ${path}: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

type ItcParticipantRow = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
};

type ItcMapRow = {
  id: string;
  participant_id: string;
  user_id: string | null;
  pillar_code: string;
  status: string;
  current_stage: string;
  updated_at: string;
};

type UserRow = {
  id: string;
  email: string;
};

interface MigrationReport {
  matched: Array<{
    participant: ItcParticipantRow;
    user: UserRow;
    maps: ItcMapRow[];
    /** True when at least one map for this participant already has
     *  user_id set to the same user (idempotent no-op path). */
    alreadyLinked: number;
    toLink: number;
  }>;
  unmatched: Array<{
    participant: ItcParticipantRow;
    mapCount: number;
    hasMultipleMaps: boolean;
  }>;
  totals: {
    participants: number;
    matchedParticipants: number;
    unmatchedParticipants: number;
    mapsAlreadyLinked: number;
    mapsToLink: number;
    unmatchedMaps: number;
  };
}

async function buildReport(): Promise<MigrationReport> {
  const participantRows = await pgGet<ItcParticipantRow[]>(
    "itc_participants?select=id,email,name,created_at&order=created_at.asc",
  );

  // Try the full select first (post-migration). If the user_id column
  // doesn't exist yet (pre-migration), fall back to the smaller select
  // and treat every map as unlinked. This makes the dry-run useful
  // BEFORE the schema migration is applied — you can plan the account
  // creations in parallel.
  let maps: ItcMapRow[];
  try {
    maps = await pgGet<ItcMapRow[]>(
      "itc_maps?select=id,participant_id,user_id,pillar_code,status,current_stage,updated_at",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("itc_maps.user_id") || msg.includes('column "user_id"')) {
      console.log(
        "NOTE: itc_maps.user_id column not found — schema migration 20260822000001_auth_phase_schema.sql hasn't been applied yet.",
      );
      console.log(
        "  Report will treat every map as unlinked. Apply the migration to enable the --apply path.\n",
      );
      const stripped = await pgGet<Omit<ItcMapRow, "user_id">[]>(
        "itc_maps?select=id,participant_id,pillar_code,status,current_stage,updated_at",
      );
      maps = stripped.map((m) => ({ ...m, user_id: null as string | null }));
    } else {
      throw err;
    }
  }

  const participants = participantRows;

  const mapsByParticipant = new Map<string, ItcMapRow[]>();
  for (const m of maps) {
    const arr = mapsByParticipant.get(m.participant_id) ?? [];
    arr.push(m);
    mapsByParticipant.set(m.participant_id, arr);
  }

  // Bulk email lookup on users — case-insensitive match against
  // itc_participants.email. participants.email is already normalized
  // to lowercase per upsertParticipantByEmail; users.email should be
  // too. Belt-and-suspenders: lowercase both sides in the lookup.
  const emails = participants.map((p) => p.email.toLowerCase());
  const uniqueEmails = [...new Set(emails)];
  const inList = uniqueEmails.map((e) => `"${e}"`).join(",");
  const userRows = uniqueEmails.length
    ? await pgGet<UserRow[]>(`users?select=id,email&email=in.(${inList})`)
    : [];
  const usersByEmail = new Map<string, UserRow>();
  for (const u of userRows) {
    usersByEmail.set(u.email.toLowerCase(), u);
  }

  const matched: MigrationReport["matched"] = [];
  const unmatched: MigrationReport["unmatched"] = [];

  for (const p of participants) {
    const pMaps = mapsByParticipant.get(p.id) ?? [];
    const user = usersByEmail.get(p.email.toLowerCase());
    if (user) {
      const alreadyLinked = pMaps.filter((m) => m.user_id === user.id).length;
      const toLink = pMaps.filter((m) => m.user_id !== user.id).length;
      matched.push({
        participant: p,
        user,
        maps: pMaps,
        alreadyLinked,
        toLink,
      });
    } else {
      unmatched.push({
        participant: p,
        mapCount: pMaps.length,
        hasMultipleMaps: pMaps.length > 1,
      });
    }
  }

  const totals = {
    participants: participants.length,
    matchedParticipants: matched.length,
    unmatchedParticipants: unmatched.length,
    mapsAlreadyLinked: matched.reduce((s, m) => s + m.alreadyLinked, 0),
    mapsToLink: matched.reduce((s, m) => s + m.toLink, 0),
    unmatchedMaps: unmatched.reduce((s, u) => s + u.mapCount, 0),
  };

  return { matched, unmatched, totals };
}

function printReport(report: MigrationReport, mode: "dry-run" | "apply") {
  const { matched, unmatched, totals } = report;

  console.log("\n=========================================================");
  console.log(`ITC PARTICIPANT MIGRATION — ${mode.toUpperCase()}`);
  console.log("=========================================================\n");

  console.log("SUMMARY");
  console.log(`  Total ITC participants:         ${totals.participants}`);
  console.log(`  Matched to users by email:       ${totals.matchedParticipants}`);
  console.log(`  Unmatched (needs manual create): ${totals.unmatchedParticipants}`);
  console.log(`  Maps already linked (no-op):     ${totals.mapsAlreadyLinked}`);
  console.log(`  Maps to be linked this run:      ${totals.mapsToLink}`);
  console.log(`  Maps for unmatched participants: ${totals.unmatchedMaps}`);

  const multiMapMatched = matched.filter((m) => m.maps.length > 1);
  if (multiMapMatched.length > 0) {
    console.log("\nPARTICIPANTS WITH MULTIPLE MAPS (all will be migrated):");
    for (const m of multiMapMatched) {
      console.log(
        `  ${m.participant.email}  (${m.maps.length} maps → user ${m.user.id.slice(0, 8)})`,
      );
      for (const map of m.maps) {
        const state =
          map.user_id === m.user.id
            ? "already linked"
            : map.user_id
              ? `LINKED TO OTHER USER ${map.user_id.slice(0, 8)}!`
              : "will link";
        console.log(
          `    - map ${map.id.slice(0, 8)}  ${map.pillar_code}/${map.status}/${map.current_stage}  [${state}]`,
        );
      }
    }
  }

  if (unmatched.length > 0) {
    console.log("\nUNMATCHED PARTICIPANTS (needs manual account creation):");
    for (const u of unmatched) {
      const flag = u.hasMultipleMaps ? ` [${u.mapCount} MAPS]` : ` [${u.mapCount} map${u.mapCount === 1 ? "" : "s"}]`;
      console.log(`  ${u.participant.email}${flag}`);
    }
    console.log(
      `\nFor each unmatched participant above: create the account via /admin/users`,
    );
    console.log(
      `(pick the right community + subscription), then re-run this script. The re-run`,
    );
    console.log(`will pick up the new match automatically.\n`);
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Review the report above.");
    console.log("To apply: npm run migrate:itc -- --apply");
    console.log("(only after Jason has reviewed this report)\n");
  }
}

async function applyLinks(
  report: MigrationReport,
): Promise<{ linked: number; errors: string[] }> {
  let linked = 0;
  const errors: string[] = [];
  for (const m of report.matched) {
    if (m.toLink === 0) continue;
    const overwriteCandidates = m.maps.filter(
      (map) => map.user_id !== null && map.user_id !== m.user.id,
    );
    if (overwriteCandidates.length > 0) {
      const detail = overwriteCandidates
        .map((c) => `${c.id} → ${c.user_id}`)
        .join(", ");
      errors.push(
        `SKIPPED ${m.participant.email}: maps already linked to different user(s): ${detail}`,
      );
      continue;
    }
    const idsToLink = m.maps
      .filter((map) => map.user_id === null)
      .map((map) => map.id);
    if (idsToLink.length === 0) continue;
    try {
      const inList = idsToLink.map((id) => `"${id}"`).join(",");
      const updated = await pgPatch<ItcMapRow[]>(
        `itc_maps?id=in.(${inList})`,
        { user_id: m.user.id },
      );
      linked += updated.length;
      console.log(
        `  linked ${updated.length} map${updated.length === 1 ? "" : "s"} → ${m.participant.email}`,
      );
    } catch (err) {
      errors.push(
        `update failed for ${m.participant.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { linked, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isDry = args.includes("--dry-run");
  if (!isApply && !isDry) {
    console.error(
      "Specify --dry-run (Checkpoint E) or --apply (Checkpoint F).\n" +
        "Usage:\n" +
        "  npm run migrate:itc -- --dry-run\n" +
        "  npm run migrate:itc -- --apply",
    );
    process.exit(1);
  }

  const report = await buildReport();
  printReport(report, isApply ? "apply" : "dry-run");

  if (!isApply) {
    process.exit(0);
  }

  console.log("\n--- APPLYING LINKS ---\n");
  const { linked, errors } = await applyLinks(report);
  console.log(`\nLinked ${linked} map${linked === 1 ? "" : "s"} in total.`);
  if (errors.length > 0) {
    console.log(`\n${errors.length} issue${errors.length === 1 ? "" : "s"} encountered:`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(2);
  }
  console.log("\nDone. Re-run with --dry-run to verify no unmatched participants remain.\n");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
