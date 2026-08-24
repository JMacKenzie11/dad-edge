/**
 * Help System — Staleness detector (Checkpoint E)
 *
 * Re-runs extraction against the current codebase and compares
 * each route/view/role's fresh source_hash against the stored
 * source_hash on the corresponding help_content row. Any mismatch
 * means the underlying UI changed since that help was generated —
 * the row's content needs a regenerate + fresh human review.
 *
 * By design: this script only REPORTS. It does not overwrite an
 * approved row automatically. Silent overwrites of approved content
 * are worse than a stale row — a reviewer would never know that
 * "documented advice" no longer matches the UI.
 *
 * Output: docs/help-content-stale.md, listing every stale row with
 * its route/view/role, the stored hash vs fresh hash, and a
 * timestamp. Empty file (with header) if nothing is stale.
 *
 * Usage:
 *   npm run help:check-stale
 *
 * Exit code: 0 always. Report is the payload, not the exit signal.
 * A CI job that fails on stale rows can grep the report for the
 * "STALE:" prefix if it wants to.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const MANIFEST_DIR = path.join(process.cwd(), "scripts", "help", "manifests");
const REPORT_PATH = path.join(process.cwd(), "docs", "help-content-stale.md");

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

type Manifest = {
  route_pattern: string;
  view_key: string | null;
  role: string;
  source_hash: string;
};

type HelpRow = {
  id: string;
  route_pattern: string;
  view_key: string | null;
  role: string;
  source_hash: string;
  reviewed: boolean;
  reviewed_at: string | null;
  generated_at: string;
};

async function fetchAllRows(): Promise<HelpRow[]> {
  const res = await fetch(
    `${REST_URL}/help_content?select=id,route_pattern,view_key,role,source_hash,reviewed,reviewed_at,generated_at`,
    {
      headers: {
        apikey: SVC_KEY,
        Authorization: `Bearer ${SVC_KEY}`,
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch help_content ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as HelpRow[];
}

function loadFreshManifests(): Manifest[] {
  const files = fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith(".json"));
  return files.map(
    (f) =>
      JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), "utf-8")) as Manifest,
  );
}

function keyFor(m: {
  route_pattern: string;
  view_key: string | null;
  role: string;
}): string {
  return `${m.route_pattern}||${m.view_key ?? ""}||${m.role}`;
}

async function main(): Promise<void> {
  console.log("[help:check-stale] re-running extraction...");
  execSync("npm run help:extract", { stdio: "inherit" });

  console.log("\n[help:check-stale] comparing manifests vs help_content...");
  const fresh = loadFreshManifests();
  const rows = await fetchAllRows();
  const rowsByKey = new Map<string, HelpRow>();
  for (const r of rows) rowsByKey.set(keyFor(r), r);

  const stale: Array<{
    manifest: Manifest;
    row: HelpRow;
  }> = [];
  const orphanRows: HelpRow[] = [];
  const missingRows: Manifest[] = [];

  const seenKeys = new Set<string>();
  for (const m of fresh) {
    const k = keyFor(m);
    seenKeys.add(k);
    const row = rowsByKey.get(k);
    if (!row) {
      missingRows.push(m);
      continue;
    }
    if (row.source_hash !== m.source_hash) {
      stale.push({ manifest: m, row });
    }
  }
  for (const r of rows) {
    if (!seenKeys.has(keyFor(r))) orphanRows.push(r);
  }

  writeReport({
    stale,
    missing: missingRows,
    orphans: orphanRows,
    totalFresh: fresh.length,
    totalRows: rows.length,
  });

  console.log(
    `\n[help:check-stale] fresh manifests: ${fresh.length}, DB rows: ${rows.length}`,
  );
  console.log(`  STALE:   ${stale.length} rows`);
  console.log(`  MISSING: ${missingRows.length} manifests without DB rows`);
  console.log(`  ORPHAN:  ${orphanRows.length} DB rows with no manifest`);
  console.log(`\nReport written to ${REPORT_PATH}`);
}

function writeReport(input: {
  stale: Array<{ manifest: Manifest; row: HelpRow }>;
  missing: Manifest[];
  orphans: HelpRow[];
  totalFresh: number;
  totalRows: number;
}): void {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# Help content — staleness report");
  lines.push("");
  lines.push(`_Generated ${now}_`);
  lines.push("");
  lines.push(
    `Fresh manifests: ${input.totalFresh}. DB rows: ${input.totalRows}. ` +
      `Stale: ${input.stale.length}. Missing: ${input.missing.length}. ` +
      `Orphan: ${input.orphans.length}.`,
  );
  lines.push("");
  lines.push(
    "**STALE** = the underlying UI changed since this help content was generated. " +
      "Regenerate via /admin/help-content → REGEN, then re-review. **Missing** = " +
      "extraction found a manifest but no DB row exists (run `npm run help:generate`). " +
      "**Orphan** = a DB row for a route/view/role that no longer exists in the code " +
      "(page was deleted / renamed); consider deleting the row.",
  );
  lines.push("");

  if (input.stale.length === 0) {
    lines.push("## STALE (0)");
    lines.push("");
    lines.push("All approved help content matches the current UI. Nothing to regenerate.");
    lines.push("");
  } else {
    lines.push(`## STALE (${input.stale.length})`);
    lines.push("");
    lines.push(
      "| Route | View | Role | Stored hash | Fresh hash | Reviewed |",
    );
    lines.push(
      "|-------|------|------|-------------|------------|----------|",
    );
    for (const s of input.stale) {
      lines.push(
        `| \`${s.manifest.route_pattern}\` | ${s.manifest.view_key ?? "—"} | ${s.manifest.role} | \`${s.row.source_hash}\` | \`${s.manifest.source_hash}\` | ${s.row.reviewed ? "yes" : "no"} |`,
      );
    }
    lines.push("");
  }

  if (input.missing.length > 0) {
    lines.push(`## MISSING (${input.missing.length})`);
    lines.push("");
    lines.push("Manifests without a DB row. Run `npm run help:generate`.");
    lines.push("");
    for (const m of input.missing) {
      lines.push(
        `- \`${m.route_pattern}\` · ${m.view_key ?? "—"} · ${m.role}`,
      );
    }
    lines.push("");
  }

  if (input.orphans.length > 0) {
    lines.push(`## ORPHAN (${input.orphans.length})`);
    lines.push("");
    lines.push(
      "DB rows for routes / views / roles no longer in the code. Safe to delete.",
    );
    lines.push("");
    for (const r of input.orphans) {
      lines.push(
        `- \`${r.route_pattern}\` · ${r.view_key ?? "—"} · ${r.role} · reviewed=${r.reviewed}`,
      );
    }
    lines.push("");
  }

  fs.writeFileSync(REPORT_PATH, lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
