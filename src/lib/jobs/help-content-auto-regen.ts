import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import {
  generatorModelId,
  regenerateAllStale,
} from "@/lib/help/regenerate";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * Nightly: detect any help_content rows whose underlying UI has
 * changed (source_hash mismatch vs manifest), regenerate them, and
 * bell-notify every platform admin so they know there's fresh
 * unreviewed copy waiting for approval on /admin/help-content.
 *
 * Design notes:
 *   - Regen still lands as reviewed=false. The human approval gate
 *     stays intact — this job just moves the work from "click REGEN
 *     manually" to "review the fresh drafts."
 *   - Notification dedup key = today's ISO date. Multiple runs in
 *     one day (unusual — cron is daily) collapse into a single bell
 *     row per admin, so a chatty extractor commit doesn't spam.
 *   - Silent no-op when nothing is stale. No notification fires and
 *     the job returns processed=0, matching the other cron jobs'
 *     shape.
 */
export async function runHelpContentAutoRegen(
  now: Date = new Date(),
): Promise<JobResult> {
  const summary = await regenerateAllStale();
  if (summary.staleTotal === 0) {
    return {
      job: "help-content-auto-regen",
      ok: true,
      processed: 0,
    };
  }

  // Fetch every platform admin so we can bell-notify each of them.
  // Small population — one COUNT + one list is cheap.
  const svc = createSupabaseServiceClient();
  const { data: admins } = await svc
    .from("users")
    .select("id")
    .eq("is_platform_admin", true);
  const adminIds = ((admins ?? []) as Array<{ id: string }>).map((a) => a.id);

  const dedupKey = now.toISOString().slice(0, 10);
  for (const userId of adminIds) {
    await enqueueNotification({
      userId,
      kind: "help_content_stale",
      dedupKey,
      title: "Help content needs review.",
      body:
        summary.failures.length === 0
          ? `${summary.regenerated} row${summary.regenerated === 1 ? "" : "s"} regenerated.`
          : `${summary.regenerated} regenerated, ${summary.failures.length} failed.`,
      deepLink: "/admin/help-content",
      metadata: {
        stale_total: summary.staleTotal,
        regenerated: summary.regenerated,
        failures: summary.failures.length,
        model: generatorModelId(),
      },
    });
  }

  return {
    job: "help-content-auto-regen",
    ok: summary.failures.length === 0,
    processed: summary.regenerated,
    errors: summary.failures,
  };
}
