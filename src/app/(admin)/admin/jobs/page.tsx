import { requirePlatformAdmin } from "@/lib/admin";
import { RunJobsPanel } from "./run-panel";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  await requirePlatformAdmin();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl">Jobs</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Trigger scheduled jobs on demand. In production these run automatically via Vercel Cron.
        </p>
      </header>
      <RunJobsPanel />
    </div>
  );
}
