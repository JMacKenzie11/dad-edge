import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { format } from "date-fns";
import { lintSections } from "@/../scripts/help/voice-lint";
import { RowEditor } from "./row-editor";

export const dynamic = "force-dynamic";

type HelpRow = {
  id: string;
  route_pattern: string;
  view_key: string | null;
  role: string;
  title: string;
  sections: Array<{ what_its_for: string; steps: string[] }>;
  voice_lint_passed: boolean;
  generated_at: string;
};

export default async function HelpContentReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePlatformAdmin();
  const { saved, error } = await searchParams;
  const svc = createSupabaseServiceClient();

  const [{ data: unreviewed }, { count: approvedCount }] = await Promise.all([
    svc
      .from("help_content")
      .select(
        "id, route_pattern, view_key, role, title, sections, voice_lint_passed, generated_at",
      )
      .eq("reviewed", false)
      // Sort lint-failed first so reviewers hit those before easy approvals.
      .order("voice_lint_passed", { ascending: true })
      .order("route_pattern", { ascending: true })
      .order("view_key", { ascending: true, nullsFirst: true })
      .order("role", { ascending: true }),
    svc
      .from("help_content")
      .select("id", { count: "exact", head: true })
      .eq("reviewed", true),
  ]);

  const rows = (unreviewed ?? []) as HelpRow[];
  const failedCount = rows.filter((r) => !r.voice_lint_passed).length;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-2xl">Help content review</h1>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Unreviewed rows sit here until approved. Only approved content
            is served to real users.
          </p>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="text-[color:var(--color-text-muted)]">
            Unreviewed:{" "}
            <span className="text-white font-heading">{rows.length}</span>
          </span>
          <span className="text-[color:var(--color-text-muted)]">
            Lint failed:{" "}
            <span
              className={
                failedCount > 0
                  ? "text-[color:var(--color-warning)] font-heading"
                  : "text-white font-heading"
              }
            >
              {failedCount}
            </span>
          </span>
          <span className="text-[color:var(--color-text-muted)]">
            Approved:{" "}
            <span className="text-[color:var(--color-success)] font-heading">
              {approvedCount ?? 0}
            </span>
          </span>
        </div>
      </header>

      {saved ? (
        <p className="text-xs text-[color:var(--color-success)]">{saved}.</p>
      ) : null}
      {error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}

      {rows.length === 0 ? (
        <div className="p-8 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-center">
          <p className="font-heading text-sm">Nothing to review.</p>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Run npm run help:generate to populate rows, or wait for a
            regenerate pass to bring content back for review.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li
              key={row.id}
              className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-heading text-sm">
                    <span className="text-[color:var(--color-accent)]">
                      {row.route_pattern}
                    </span>
                    {row.view_key ? (
                      <span className="text-[color:var(--color-text-muted)]">
                        {" "}
                        · {row.view_key}
                      </span>
                    ) : null}
                    <span
                      className="ml-3 text-[10px] tracking-widest uppercase text-[color:var(--color-text-muted)]"
                    >
                      role: {row.role}
                    </span>
                  </p>
                  <p className="text-[10px] text-[color:var(--color-text-muted)] mt-0.5">
                    generated {format(new Date(row.generated_at), "MMM d, HH:mm")}
                  </p>
                </div>
              </div>
              <RowEditor
                id={row.id}
                title={row.title}
                sections={row.sections}
                voiceLintPassed={row.voice_lint_passed}
                lintHits={
                  row.voice_lint_passed
                    ? []
                    : lintSections(row.sections).hits
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
