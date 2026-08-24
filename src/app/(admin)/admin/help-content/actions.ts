"use server";

import * as fs from "node:fs";
import * as path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { generateObject } from "ai";
import { requirePlatformAdmin } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { utilityModel } from "@/lib/model-config";
import { lintSections } from "@/../scripts/help/voice-lint";
import { auditLog } from "@/lib/audit";

// Reuse the same schema shape as the generator script. Kept local to
// this file rather than shared because the shape is small and
// scripts/ vs src/ import boundaries are fragile in Next builds.
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

// ---------------------------------------------------------------------------
// Approve — flip reviewed=true, stamp reviewer + timestamp
// ---------------------------------------------------------------------------

export async function approveHelpContent(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/help-content?error=Missing+id");

  const svc = createSupabaseServiceClient();

  // Read current lint status so we can audit-log lint-override
  // approvals distinctly. Not blocking — approve works either way,
  // per product decision that some lint hits are too literal to
  // require an edit.
  const { data: existing } = await svc
    .from("help_content")
    .select("voice_lint_passed")
    .eq("id", id)
    .maybeSingle();
  const wasLintPassed = Boolean(
    (existing as { voice_lint_passed: boolean } | null)?.voice_lint_passed,
  );

  const { error } = await svc
    .from("help_content")
    .update({
      reviewed: true,
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    redirect(
      `/admin/help-content?error=${encodeURIComponent(error.message)}`,
    );
  }

  await auditLog({
    actor_user_id: admin.id,
    action: wasLintPassed
      ? "help_content.approve"
      : "help_content.approve_override",
    target_type: "help_content",
    target_id: id,
    metadata: { voice_lint_passed: wasLintPassed },
  });

  revalidatePath("/admin/help-content");
  redirect(
    wasLintPassed
      ? "/admin/help-content?saved=Approved"
      : "/admin/help-content?saved=Approved+(lint+override)",
  );
}

// ---------------------------------------------------------------------------
// Edit-then-approve — overwrite title + sections, then approve
// ---------------------------------------------------------------------------

export async function editAndApproveHelpContent(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const sectionsRaw = String(formData.get("sections_json") ?? "");

  if (!id) redirect("/admin/help-content?error=Missing+id");

  let sections: Sections;
  try {
    sections = HelpContentSchema.shape.sections.parse(JSON.parse(sectionsRaw));
  } catch (err) {
    redirect(
      `/admin/help-content?error=${encodeURIComponent(
        `Invalid sections JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )}`,
    );
  }

  const lint = lintSections(sections);

  const svc = createSupabaseServiceClient();
  const { error } = await svc
    .from("help_content")
    .update({
      title,
      sections,
      voice_lint_passed: lint.passed,
      reviewed: true,
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    redirect(
      `/admin/help-content?error=${encodeURIComponent(error.message)}`,
    );
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "help_content.edit_approve",
    target_type: "help_content",
    target_id: id,
    metadata: { voice_lint_passed: lint.passed },
  });

  revalidatePath("/admin/help-content");
  redirect("/admin/help-content?saved=Saved+and+approved");
}

// ---------------------------------------------------------------------------
// Regenerate — re-run generation for a single row from its manifest
// ---------------------------------------------------------------------------

/**
 * Derive the manifest filename from the row's route/view/role using
 * the same convention as scripts/help/extract-routes.ts. Route
 * segments become underscores, brackets stay.
 */
function manifestFilenameFor(
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
 * Regenerate a single row against its manifest. Returns a discriminated
 * result so bulk callers can tally successes vs failures without a
 * try/catch dance. Does not touch the DB — caller writes the result.
 */
async function generateForRow(row: {
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

export async function regenerateHelpContent(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/help-content?error=Missing+id");

  const svc = createSupabaseServiceClient();
  const { data: existing } = await svc
    .from("help_content")
    .select("route_pattern, view_key, role")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    redirect("/admin/help-content?error=Row+not+found");
  }
  const row = existing as {
    route_pattern: string;
    view_key: string | null;
    role: string;
  };

  const result = await generateForRow(row);
  if (!result.ok) {
    redirect(
      `/admin/help-content?error=${encodeURIComponent(
        `Regenerate failed: ${result.reason}`,
      )}`,
    );
  }

  const { error } = await svc
    .from("help_content")
    .update({
      title: result.title,
      sections: result.sections,
      source_hash: result.source_hash,
      voice_lint_passed: result.voice_lint_passed,
      // Regenerate resets review — new content, new approval needed.
      reviewed: false,
      reviewed_by: null,
      reviewed_at: null,
      generated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    redirect(
      `/admin/help-content?error=${encodeURIComponent(error.message)}`,
    );
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "help_content.regenerate",
    target_type: "help_content",
    target_id: id,
    metadata: { voice_lint_passed: result.voice_lint_passed },
  });

  revalidatePath("/admin/help-content");
  redirect("/admin/help-content?saved=Regenerated");
}

// ---------------------------------------------------------------------------
// Regenerate stale — re-run generation for every row whose stored
// source_hash no longer matches its manifest's fresh source_hash.
// Used after an extractor fix ripples through many pages, so the
// admin doesn't have to click REGEN one row at a time.
// ---------------------------------------------------------------------------

/**
 * Load all committed manifests, keyed by (route|view|role). Bulk
 * staleness check reads this once instead of doing per-row disk I/O.
 */
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

/**
 * Compare every DB row's source_hash against its manifest's fresh
 * hash. Returns the row IDs that need regeneration. Exported so the
 * review page can show a "N stale" count in the header.
 */
export async function findStaleHelpContentIds(): Promise<string[]> {
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("help_content")
    .select("id, route_pattern, view_key, role, source_hash");
  const rows = (data ?? []) as Array<{
    id: string;
    route_pattern: string;
    view_key: string | null;
    role: string;
    source_hash: string;
  }>;
  const manifests = loadAllManifestsByKey();
  const stale: string[] = [];
  for (const r of rows) {
    const fresh = manifests.get(
      `${r.route_pattern}||${r.view_key ?? ""}||${r.role}`,
    );
    // Skip rows whose manifest is missing (orphans) — those need
    // manual deletion, not regeneration.
    if (fresh && fresh !== r.source_hash) stale.push(r.id);
  }
  return stale;
}

export async function regenerateStaleHelpContent() {
  const admin = await requirePlatformAdmin();
  const svc = createSupabaseServiceClient();

  const staleIds = await findStaleHelpContentIds();
  if (staleIds.length === 0) {
    redirect("/admin/help-content?saved=No+stale+rows");
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

  await auditLog({
    actor_user_id: admin.id,
    action: "help_content.regenerate_stale",
    target_type: "help_content",
    target_id: null,
    metadata: {
      stale_total: staleIds.length,
      regenerated,
      failures: failures.length,
    },
  });

  revalidatePath("/admin/help-content");
  const msg =
    failures.length === 0
      ? `Regenerated ${regenerated} stale row${regenerated === 1 ? "" : "s"}`
      : `Regenerated ${regenerated} of ${staleIds.length} (${failures.length} failed)`;
  redirect(`/admin/help-content?saved=${encodeURIComponent(msg)}`);
}
