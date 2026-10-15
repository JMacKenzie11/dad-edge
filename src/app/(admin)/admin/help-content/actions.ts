"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { lintSections } from "@/../scripts/help/voice-lint";
import { auditLog } from "@/lib/audit";
import { generateForRow } from "@/lib/help/regenerate";
import { publishedColumns } from "@/lib/help/publish";

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
      // Live straight away: generateForRow only returns drafts that
      // passed the voice lint (src/lib/help/publish.ts).
      ...publishedColumns(),
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

// NB: `findStaleHelpContentIds` + `regenerateAllStale` now live in
// `src/lib/help/regenerate.ts` so the nightly auto-regen cron can
// share the same code. The action below is a thin wrapper around
// that helper that adds admin auth + redirect + audit-log semantics.

export async function regenerateStaleHelpContent() {
  const admin = await requirePlatformAdmin();
  const { regenerateAllStale } = await import("@/lib/help/regenerate");
  const summary = await regenerateAllStale();

  if (summary.staleTotal === 0 && summary.missingTotal === 0) {
    redirect("/admin/help-content?saved=No+stale+rows");
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "help_content.regenerate_stale",
    target_type: "help_content",
    target_id: null,
    metadata: {
      stale_total: summary.staleTotal,
      regenerated: summary.regenerated,
      failures: summary.failures.length,
    },
  });

  revalidatePath("/admin/help-content");
  const msg =
    summary.failures.length === 0
      ? `Regenerated ${summary.regenerated} stale row${summary.regenerated === 1 ? "" : "s"}`
      : `Regenerated ${summary.regenerated} of ${summary.staleTotal + summary.missingTotal} (${summary.failures.length} failed)`;
  redirect(`/admin/help-content?saved=${encodeURIComponent(msg)}`);
}
