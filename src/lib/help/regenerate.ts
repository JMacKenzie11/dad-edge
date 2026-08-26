import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { generateObject } from "ai";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { utilityModel, utilityModelIdOrUnset } from "@/lib/model-config";
import { lintSections } from "@/../scripts/help/voice-lint";

/**
 * Shared help-content regeneration primitives. Callers:
 *   - The admin server action `regenerateStaleHelpContent` (from
 *     /admin/help-content REGEN ALL STALE button)
 *   - The nightly cron job `runHelpContentAutoRegen`
 *
 * Kept as plain functions (no `"use server"`, no redirect) so both
 * callers can consume the same code path. Each caller wraps the
 * results in the response shape it needs (redirect, JobResult, etc.).
 */

const HelpContentSchema = z.object({
  title: z.string().min(3).max(80),
  sections: z
    .array(
      z.object({
        what_its_for: z.string().min(10).max(240),
        steps: z.array(z.string().min(3).max(240)).min(1).max(8),
      }),
    )
    .min(1)
    .max(10),
});
type Sections = z.infer<typeof HelpContentSchema>["sections"];

export type HelpContentRow = {
  id: string;
  route_pattern: string;
  view_key: string | null;
  role: string;
  source_hash: string;
};

/**
 * Route-slug convention borrowed from scripts/help/extract-routes.ts.
 * Kept in sync manually — a mismatch here just means we can't find
 * the manifest, which lands as a graceful failure in the caller.
 * Exported for the drift-guard test in src/lib/__tests__/help-regenerate.test.ts.
 */
export function manifestFilenameFor(
  routePattern: string,
  viewKey: string | null,
  role: string,
): string {
  const safe = (s: string) =>
    s.replace(/[^a-z0-9-]/gi, "_").replace(/^_+|_+$/g, "");
  const route = safe(routePattern.replace(/^\//, "") || "root");
  const view = viewKey ? `__${safe(viewKey)}` : "";
  return `${route}${view}__${role}.json`;
}

function loadManifest(filename: string): {
  route_pattern: string;
  view_key: string | null;
  role: string;
  elements: Array<{ kind: string; label: string }>;
  source_hash: string;
} | null {
  const full = path.join(
    process.cwd(),
    "scripts",
    "help",
    "manifests",
    filename,
  );
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

function loadAllManifestsByKey(): Map<string, string> {
  const dir = path.join(process.cwd(), "scripts", "help", "manifests");
  if (!fs.existsSync(dir)) return new Map();
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as {
      route_pattern: string;
      view_key: string | null;
      role: string;
      source_hash: string;
    };
    out.set(`${m.route_pattern}||${m.view_key ?? ""}||${m.role}`, m.source_hash);
  }
  return out;
}

function findRoutePurpose(routePattern: string, spec: string): string | null {
  const lines = spec.split("\n");
  const escaped = routePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\|\\s*\`${escaped}(?:\\[[^\\]]+\\])?\`\\s*\\|`,
  );
  for (const line of lines) {
    if (pattern.test(line)) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length >= 3) {
        const purpose = cells[cells.length - 2];
        if (purpose && purpose.length > 20) return purpose;
      }
    }
  }
  return null;
}

/**
 * Load every DB row and compare its source_hash to the current
 * on-disk manifest hash. Returns just the ids that need
 * regeneration. Skips rows whose manifest is missing (orphans —
 * those need manual deletion, not regen).
 */
export async function findStaleHelpContentIds(): Promise<string[]> {
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("help_content")
    .select("id, route_pattern, view_key, role, source_hash");
  const rows = (data ?? []) as HelpContentRow[];
  const manifests = loadAllManifestsByKey();
  const stale: string[] = [];
  for (const r of rows) {
    const fresh = manifests.get(
      `${r.route_pattern}||${r.view_key ?? ""}||${r.role}`,
    );
    if (fresh && fresh !== r.source_hash) stale.push(r.id);
  }
  return stale;
}

/**
 * Regenerate one row against its manifest. Returns a discriminated
 * union so bulk callers can tally successes vs failures without a
 * try/catch dance. Does not touch the DB — caller writes the result.
 */
export async function generateForRow(row: {
  route_pattern: string;
  view_key: string | null;
  role: string;
}): Promise<
  | {
      ok: true;
      title: string;
      sections: Sections;
      source_hash: string;
      voice_lint_passed: boolean;
    }
  | { ok: false; reason: string }
> {
  const filename = manifestFilenameFor(row.route_pattern, row.view_key, row.role);
  const manifest = loadManifest(filename);
  if (!manifest) {
    return {
      ok: false,
      reason: `Manifest not found: ${filename} — run npm run help:extract first.`,
    };
  }

  const spec = fs.readFileSync(
    path.join(process.cwd(), "PRODUCT_SPEC.md"),
    "utf-8",
  );
  const voiceDoc = fs.readFileSync(
    path.join(process.cwd(), "docs", "app-voice-adaptation.md"),
    "utf-8",
  );
  const purpose = findRoutePurpose(row.route_pattern, spec);

  const system = `You write in-app HELP content for the BRAVE MAN OS. Reference content, not a coach turn. Written for a man scanning the app who wants to know what a button does or how to complete a step. Plain, tight, useful.

Hard constraints:

1. GROUNDED. You may only describe capabilities that correspond to elements in the ELEMENT LIST below. If an element isn't listed, you cannot describe it.

2. LITERAL LABELS. When you reference an element, use its exact visible label wrapped in **bold**. Not paraphrases. "tap **Add**" — not "tap the add button". If a label is uppercase, keep it uppercase.

3. NO CONVERSATION. This is reference content. No "let's", no "welcome to", no closing questions.

4. VOICE RULES. Obey the voice adaptation guide below in full.

5. FORMAT. Structured JSON matching the schema.

===== VOICE RULES =====

${voiceDoc}

===== END VOICE RULES =====`;

  const roleLine =
    manifest.role === "all"
      ? "Audience: any signed-in user."
      : `Audience: ${manifest.role} role only.`;
  const viewLine = manifest.view_key
    ? `View: served when the user's current view is "${manifest.view_key}".`
    : "";
  const purposeLine = purpose
    ? `Page purpose (from PRODUCT_SPEC.md): ${purpose}`
    : "Page purpose: not documented; infer conservatively from the elements below.";
  const elementLines = manifest.elements
    .map((e, i) => `${i + 1}. [${e.kind}] "${e.label}"`)
    .join("\n");
  const prompt = `Route: ${manifest.route_pattern}
${viewLine}
${roleLine}

${purposeLine}

ELEMENT LIST (the only capabilities you may describe):
${elementLines || "(no interactive elements — display-only surface)"}

Produce the JSON now.`;

  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: HelpContentSchema,
      system,
      prompt,
      maxOutputTokens: 1500,
    });
    const lint = lintSections(object.sections);
    return {
      ok: true,
      title: object.title,
      sections: object.sections,
      source_hash: manifest.source_hash,
      voice_lint_passed: lint.passed,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The whole stale-regen sweep. Both the admin action and the
 * nightly cron call this and diverge only in how they report
 * results.
 */
export async function regenerateAllStale(): Promise<{
  staleTotal: number;
  regenerated: number;
  failures: string[];
}> {
  const svc = createSupabaseServiceClient();
  const staleIds = await findStaleHelpContentIds();
  if (staleIds.length === 0) {
    return { staleTotal: 0, regenerated: 0, failures: [] };
  }

  const { data } = await svc
    .from("help_content")
    .select("id, route_pattern, view_key, role")
    .in("id", staleIds);
  const rows = (data ?? []) as Array<{
    id: string;
    route_pattern: string;
    view_key: string | null;
    role: string;
  }>;

  let regenerated = 0;
  const failures: string[] = [];
  for (const row of rows) {
    const result = await generateForRow(row);
    if (!result.ok) {
      failures.push(`${row.route_pattern} (${row.role}): ${result.reason}`);
      continue;
    }
    const { error } = await svc
      .from("help_content")
      .update({
        title: result.title,
        sections: result.sections,
        source_hash: result.source_hash,
        voice_lint_passed: result.voice_lint_passed,
        reviewed: false,
        reviewed_by: null,
        reviewed_at: null,
        generated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      failures.push(`${row.route_pattern} (${row.role}): ${error.message}`);
      continue;
    }
    regenerated += 1;
  }

  return { staleTotal: staleIds.length, regenerated, failures };
}

/**
 * Model id the generator is currently pointed at. Exposed for audit /
 * job-result metadata.
 */
export function generatorModelId(): string {
  return utilityModelIdOrUnset();
}
