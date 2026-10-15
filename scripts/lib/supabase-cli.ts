import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_PROJECT_REFS, PROD_PROJECT_REF } from "./target";

/**
 * Running SQL through the Supabase CLI (`supabase db query --linked`), which
 * goes through the Management API: no database password, no Docker. Used by
 * the permission probes and the migration command.
 *
 * Which project a `--linked` command hits is whatever `supabase link` last
 * pointed at, recorded in supabase/.temp/project-ref. Every caller checks
 * that file first, so a forgotten `supabase link` can't send a probe or a
 * migration to the wrong database.
 */

export function linkedProjectRef(cwd = process.cwd()): string | null {
  try {
    return readFileSync(join(cwd, "supabase", ".temp", "project-ref"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Throws unless the CLI is linked to a dev project. */
export function assertLinkedDev(ref = linkedProjectRef()): string {
  if (!ref) throw new Error("The Supabase CLI isn't linked to a project. Run `supabase link --project-ref <dev ref>`.");
  if (ref === PROD_PROJECT_REF) throw new Error("The Supabase CLI is linked to PRODUCTION. Refusing. Run `supabase link --project-ref <dev ref>` first.");
  if (!DEV_PROJECT_REFS.includes(ref)) throw new Error(`The Supabase CLI is linked to ${ref}, which isn't a known dev project (scripts/lib/target.ts).`);
  return ref;
}

export type SqlResult = { ok: true; rows: Record<string, unknown>[] } | { ok: false; message: string };

/** Pulls the Postgres error text out of the CLI's error envelope. */
export function parseCliError(output: string): string {
  const m = output.match(/Failed to run sql query: ([\s\S]*?)(\\n|")\s*\}/);
  if (m) return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  const plain = output.match(/"message":"([^"]*)"/);
  return plain ? plain[1] : output.trim();
}

export function runLinkedSql(sql: string): SqlResult {
  const dir = mkdtempSync(join(tmpdir(), "sbq-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, sql);
  const res = spawnSync("supabase", ["db", "query", "--linked", "-f", file, "-o", "json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (res.status === 0 && !out.includes('"_tag":"Error"')) {
    const start = (res.stdout ?? "").indexOf("{");
    try {
      const body = JSON.parse((res.stdout ?? "").slice(start)) as { rows?: Record<string, unknown>[] };
      return { ok: true, rows: body.rows ?? [] };
    } catch {
      return { ok: true, rows: [] };
    }
  }
  return { ok: false, message: parseCliError(out) };
}
