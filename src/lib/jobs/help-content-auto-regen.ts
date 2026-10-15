import { regenerateAllStale } from "@/lib/help/regenerate";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * Nightly: regenerate help for any page whose controls changed
 * (source_hash mismatch vs manifest) and write help for any page that
 * has none yet. Each draft that passes the voice lint goes live
 * straight away; there is no approval step (DECISIONS.md "Help
 * publishes itself"). A page whose drafts keep failing keeps its
 * current help and shows up in this job's errors on /admin/jobs, and
 * the next night tries it again.
 *
 * Silent no-op when nothing is stale or missing.
 */
export async function runHelpContentAutoRegen(): Promise<JobResult> {
  const summary = await regenerateAllStale();
  return {
    job: "help-content-auto-regen",
    ok: summary.failures.length === 0,
    processed: summary.regenerated,
    ...(summary.failures.length ? { errors: summary.failures } : {}),
  };
}
