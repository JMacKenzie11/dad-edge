/**
 * The one way migrations reach a database (CLAUDE.md, Migrations).
 *
 *   npm run db:migrate -- --target dev --dry-run     list pending, apply nothing
 *   npm run db:migrate -- --target dev               apply pending to dev
 *   npm run db:migrate -- --target dev --baseline    record already-applied files (one time)
 *   npm run db:migrate -- --target prod --dry-run    what production is missing
 *   npm run db:migrate -- --target prod              Jason approves every run
 *
 * Why this exists (docs/failure-modes.md FM-5): migrations were applied by
 * hand, so no database recorded which ones ran, and the README's `supabase
 * db push` would have tried to rerun all of them. This keeps a ledger in
 * supabase_migrations.schema_migrations and applies only files missing from
 * it, each file and its ledger row in one transaction, stopping at the
 * first failure.
 *
 * Ledger keys are the full file name (without .sql), not the CLI's bare
 * timestamp: two files here share 20260822000001. A side effect is that
 * `supabase db push` now refuses to run against these databases, which is
 * intended.
 *
 * Target checks are by project id (scripts/lib/target.ts), against the
 * project the Supabase CLI is linked to:
 *   dev   CLI must be linked to a dev project.
 *   prod  CLI must be linked to production, AND the run must be confirmed
 *         by typing the production project id (interactive) or by
 *         MIGRATE_PROD_CONFIRM=<production project id> (non-interactive).
 *         Claude only sets that after Jason approves that specific run in
 *         chat, every time, even after a clean dry run.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { isEntryPoint } from "./lib/entry";
import { assertLinkedDev, linkedProjectRef, runLinkedSql } from "./lib/supabase-cli";
import { PROD_PROJECT_REF } from "./lib/target";

const DIR = join(process.cwd(), "supabase", "migrations");

export function migrationVersion(file: string): string {
  return file.replace(/\.sql$/, "");
}

export function listMigrationFiles(names: string[]): string[] {
  return names.filter((n) => /^\d{14}_.+\.sql$/.test(n)).sort();
}

export function pendingMigrations(files: string[], applied: Set<string>): string[] {
  return files.filter((f) => !applied.has(migrationVersion(f)));
}

/** Files that would apply out of order: pending, but older than the newest applied. */
export function outOfOrder(files: string[], applied: Set<string>): string[] {
  const newest = [...applied].sort().pop();
  if (!newest) return [];
  return pendingMigrations(files, applied).filter((f) => migrationVersion(f) < newest);
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const LEDGER_DDL = `
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);`;

function readLedger(): Set<string> | null {
  const res = runLinkedSql(
    "select version from supabase_migrations.schema_migrations where to_regclass('supabase_migrations.schema_migrations') is not null",
  );
  if (!res.ok) {
    if (/does not exist/.test(res.message)) return null;
    throw new Error(`Couldn't read the migration ledger: ${res.message}`);
  }
  return new Set(res.rows.map((r) => String(r.version)));
}

async function confirmProd(): Promise<boolean> {
  if (process.env.MIGRATE_PROD_CONFIRM === PROD_PROJECT_REF) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type the production project id to apply to PRODUCTION: `);
  rl.close();
  return answer.trim() === PROD_PROJECT_REF;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ti = args.indexOf("--target");
  const target = ti >= 0 ? args[ti + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  const baseline = args.includes("--baseline");
  if (target !== "dev" && target !== "prod") {
    console.error("Usage: db:migrate --target dev|prod [--dry-run] [--baseline]");
    process.exit(2);
  }

  const linked = linkedProjectRef();
  if (target === "dev") {
    assertLinkedDev(linked);
  } else if (linked !== PROD_PROJECT_REF) {
    console.error(`[db:migrate] --target prod, but the Supabase CLI is linked to ${linked ?? "nothing"}. Run \`supabase link --project-ref <production ref>\` first.`);
    process.exit(2);
  }

  const files = listMigrationFiles(readdirSync(DIR));
  const ledger = readLedger();
  const applied = ledger ?? new Set<string>();
  const pending = pendingMigrations(files, applied);

  console.log(`[db:migrate] ${target} (${linked}): ${files.length} files, ${applied.size} in the ledger${ledger ? "" : " (no ledger yet)"}, ${pending.length} pending.`);
  for (const f of pending) console.log(`  pending  ${f}`);
  const late = outOfOrder(files, applied);
  if (late.length) {
    console.log(`  note: ${late.length} pending file(s) are older than the newest applied one and would run out of order:`);
    for (const f of late) console.log(`    ${f}`);
  }

  if (!ledger && !baseline) {
    console.log("\nThis database has no ledger. If its schema already matches these files (it was migrated by hand), record them with --baseline instead of applying them.");
    if (!dryRun) process.exit(2);
  }
  if (dryRun) {
    console.log("\nDry run: nothing applied.");
    return;
  }
  if (pending.length === 0 && !baseline) {
    console.log("Nothing to apply.");
    return;
  }

  if (target === "prod" && !(await confirmProd())) {
    console.error("[db:migrate] production run not confirmed. Nothing applied.");
    process.exit(2);
  }

  if (baseline) {
    // Record without running: for databases whose schema was built by hand.
    const rows = pending.map((f) => `(${lit(migrationVersion(f))}, null, ${lit(migrationVersion(f))})`).join(",\n  ");
    const res = runLinkedSql(`begin;${LEDGER_DDL}\n${rows ? `insert into supabase_migrations.schema_migrations (version, statements, name) values\n  ${rows};` : ""}\ncommit;`);
    if (!res.ok) {
      console.error(`[db:migrate] baseline failed: ${res.message}`);
      process.exit(1);
    }
    console.log(`Baseline recorded: ${pending.length} file(s) marked as applied, none run.`);
    return;
  }

  for (const f of pending) {
    const sql = readFileSync(join(DIR, f), "utf8");
    const version = migrationVersion(f);
    const res = runLinkedSql(
      `begin;${LEDGER_DDL}\n${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, statements, name) values (${lit(version)}, null, ${lit(version)});\ncommit;`,
    );
    if (!res.ok) {
      console.error(`[db:migrate] ${f} failed and was rolled back; nothing after it ran.\n${res.message}`);
      process.exit(1);
    }
    console.log(`  applied  ${f}`);
  }
  console.log(`Applied ${pending.length} migration(s) to ${target}.`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
