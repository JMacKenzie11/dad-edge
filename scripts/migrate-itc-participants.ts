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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Loose alias — this script talks to arbitrary tables without a
// generated Database type. Passing the fully-parameterized client
// through the helper signatures tripped TS on schema inference.
type Db = SupabaseClient;

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

async function buildReport(sb: Db): Promise<MigrationReport> {
  const [{ data: participantRows, error: pErr }, { data: mapRows, error: mErr }] =
    await Promise.all([
      sb
        .from("itc_participants")
        .select("id, email, name, created_at")
        .order("created_at", { ascending: true }),
      sb
        .from("itc_maps")
        .select(
          "id, participant_id, user_id, pillar_code, status, current_stage, updated_at",
        ),
    ]);
  if (pErr) throw new Error(`itc_participants read: ${pErr.message}`);
  if (mErr) throw new Error(`itc_maps read: ${mErr.message}`);

  const participants = (participantRows ?? []) as ItcParticipantRow[];
  const maps = (mapRows ?? []) as ItcMapRow[];

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
  const { data: userRows, error: uErr } = await sb
    .from("users")
    .select("id, email")
    .in("email", uniqueEmails);
  if (uErr) throw new Error(`users lookup: ${uErr.message}`);
  const usersByEmail = new Map<string, UserRow>();
  for (const u of (userRows ?? []) as UserRow[]) {
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
  sb: Db,
  report: MigrationReport,
): Promise<{ linked: number; errors: string[] }> {
  let linked = 0;
  const errors: string[] = [];
  for (const m of report.matched) {
    if (m.toLink === 0) continue;
    // Only update maps whose user_id is null or points at a different
    // user. The safety guard also refuses to overwrite a user_id that
    // already points at someone else — that would be a data-loss
    // situation the operator should investigate manually.
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
    const { error, count } = await sb
      .from("itc_maps")
      .update({ user_id: m.user.id }, { count: "exact" })
      .in("id", idsToLink);
    if (error) {
      errors.push(`update failed for ${m.participant.email}: ${error.message}`);
      continue;
    }
    linked += count ?? idsToLink.length;
    console.log(
      `  linked ${idsToLink.length} map${idsToLink.length === 1 ? "" : "s"} → ${m.participant.email}`,
    );
  }
  return { linked, errors };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

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

  const report = await buildReport(sb);
  printReport(report, isApply ? "apply" : "dry-run");

  if (!isApply) {
    process.exit(0);
  }

  console.log("\n--- APPLYING LINKS ---\n");
  const { linked, errors } = await applyLinks(sb, report);
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
