/**
 * Reset users.onboarding_step so they re-enter the wizard.
 *
 * Used after adding a new onboarding step to force existing "already
 * completed" users through the new step. Currently: /onboarding/profile
 * was added at step 1 (avatar + city + phone); existing users are at
 * step >= 7 (old completion) or step >= 8 (post-migration completion).
 *
 * The script is data-modifying but idempotent: running it twice with
 * the same target step produces the same DB state.
 *
 * Usage:
 *
 *   Preview (safe, prints who would be changed):
 *     npm run reset:onboarding -- --dry-run
 *     npm run reset:onboarding -- --dry-run --email jason@example.com
 *
 *   Apply:
 *     npm run reset:onboarding -- --apply
 *     npm run reset:onboarding -- --apply --email jason@example.com
 *
 *   Custom target step (default: 1, the new profile step):
 *     npm run reset:onboarding -- --apply --step 0    (send them all the way back)
 *     npm run reset:onboarding -- --apply --step 1    (default — just profile)
 *     npm run reset:onboarding -- --apply --step 2    (skip profile too, land on why)
 *
 * Behavior:
 *   - By default, only touches users whose current step is HIGHER
 *     than the target (they're past it). This is deliberate: a user
 *     currently at step 3 shouldn't be pushed BACKWARD by this
 *     script, since they might still be mid-flow.
 *   - --email limits the run to a single user (matched
 *     case-insensitively). Without --email, all matching users are
 *     touched.
 *   - Platform admins are skipped by default (they bypass the
 *     onboarding gate anyway). Pass --include-admins to override.
 *
 * Data ownership: only users.onboarding_step changes. All prior data
 * (first_name, why_yes, kids, partner, etc.) stays intact — the user
 * just re-sees the wizard pages, pre-filled with their existing
 * answers, and hits Next through them.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Direct REST fetch — same reason as migrate-itc-participants.ts:
// supabase-js does local JWT time validation that can fail in
// environments with clock drift. Raw fetch bypasses that.
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
    const responseBody = await res.text();
    throw new Error(
      `PATCH ${path}: ${res.status} ${responseBody.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

type UserRow = {
  id: string;
  email: string;
  first_name: string | null;
  onboarding_step: number | null;
  is_platform_admin: boolean;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    dryRun: args.includes("--dry-run"),
    apply: args.includes("--apply"),
    includeAdmins: args.includes("--include-admins"),
    email: null as string | null,
    step: 1,
  };
  const emailIdx = args.indexOf("--email");
  if (emailIdx >= 0 && args[emailIdx + 1]) {
    flags.email = args[emailIdx + 1]!.trim().toLowerCase();
  }
  const stepIdx = args.indexOf("--step");
  if (stepIdx >= 0 && args[stepIdx + 1]) {
    const n = Number.parseInt(args[stepIdx + 1]!, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 8) flags.step = n;
    else {
      console.error("--step must be an integer between 0 and 8");
      process.exit(1);
    }
  }
  if (flags.dryRun === flags.apply) {
    console.error("Pass exactly one of --dry-run or --apply.");
    process.exit(1);
  }
  return flags;
}

async function main() {
  const flags = parseArgs();
  const mode = flags.apply ? "APPLY" : "DRY-RUN";
  console.log(
    `[${mode}] target step: ${flags.step}${
      flags.email ? ` · email: ${flags.email}` : " · all matching users"
    }${flags.includeAdmins ? " · including admins" : " · excluding admins"}`,
  );
  console.log();

  // Fetch candidates. Only rows with onboarding_step > target are
  // touched (we never push someone backward mid-flow).
  const filterParts: string[] = [
    "select=id,email,first_name,onboarding_step,is_platform_admin",
    `onboarding_step=gt.${flags.step}`,
  ];
  if (flags.email) {
    filterParts.push(`email=ilike.${encodeURIComponent(flags.email)}`);
  }
  if (!flags.includeAdmins) {
    filterParts.push("is_platform_admin=eq.false");
  }
  const filter = filterParts.join("&");
  const users = await pgGet<UserRow[]>(`users?${filter}`);

  if (users.length === 0) {
    console.log("No users match. Nothing to do.");
    return;
  }

  console.log(`Found ${users.length} user${users.length === 1 ? "" : "s"}:`);
  for (const u of users) {
    console.log(
      `  ${u.email.padEnd(40)}  step ${u.onboarding_step ?? 0} → ${flags.step}${
        u.is_platform_admin ? "  [ADMIN]" : ""
      }`,
    );
  }
  console.log();

  if (flags.dryRun) {
    console.log("[DRY-RUN] No changes made. Re-run with --apply to commit.");
    return;
  }

  let updated = 0;
  for (const u of users) {
    try {
      await pgPatch<UserRow[]>(`users?id=eq.${u.id}`, {
        onboarding_step: flags.step,
      });
      updated += 1;
    } catch (err) {
      console.warn(
        `  FAILED to update ${u.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  console.log(`[APPLY] Updated ${updated} of ${users.length} user rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
