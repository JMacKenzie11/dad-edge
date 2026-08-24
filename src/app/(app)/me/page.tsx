import Link from "next/link";
import { format } from "date-fns";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { UserAvatar } from "@/components/ui/user-avatar";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : format(d, "MMMM d, yyyy");
}

export const dynamic = "force-dynamic";

export default async function MePage() {
  const { user } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const [{ data: partner }, { data: kids }, { data: latestSurvey }, { data: priorSurvey }] =
    await Promise.all([
      supabase
        .from("partner_profiles")
        .select("partner_name, relationship_label, partner_birthdate, relationship_date, things_loved")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("children").select("id, name, birthdate, things_loved").eq("user_id", user.id).order("created_at"),
      supabase
        .from("partner_surveys")
        .select("id, taken_at, responses:partner_survey_responses(score)")
        .eq("user_id", user.id)
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("partner_surveys")
        .select("id, taken_at, responses:partner_survey_responses(score)")
        .eq("user_id", user.id)
        .order("taken_at", { ascending: false })
        .range(1, 1)
        .maybeSingle(),
    ]);

  const compositeOf = (row: { responses: { score: number }[] } | null | undefined) =>
    row && row.responses.length > 0
      ? row.responses.reduce((n, r) => n + r.score, 0) / row.responses.length
      : null;

  const latestComp = compositeOf(latestSurvey as { responses: { score: number }[] } | null);
  const priorComp = compositeOf(priorSurvey as { responses: { score: number }[] } | null);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header className="flex items-center gap-4">
        <UserAvatar
          url={user.avatar_url}
          firstName={user.first_name}
          lastName={user.last_name}
          email={user.email}
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-3xl truncate">
            {[user.first_name, user.last_name].filter(Boolean).join(" ") || "Me"}
          </h1>
          <p className="text-sm text-[color:var(--color-text-muted)] truncate">
            {user.email}
          </p>
          {user.city ? (
            <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
              {user.city}
            </p>
          ) : null}
        </div>
        <Link
          href="/onboarding/profile"
          className="text-xs text-[color:var(--color-text-muted)] underline shrink-0"
        >
          Edit
        </Link>
      </header>

      <Link
        href="/dashboard"
        className="flex items-center justify-between p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:border-[color:var(--color-primary)] transition-colors"
      >
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            YOUR RECORD
          </p>
          <p className="font-heading text-lg mt-1">Dashboard</p>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Daily Living, mission completion, survey delta, and any active ITC map.
          </p>
        </div>
        <span className="text-[color:var(--color-primary)]">→</span>
      </Link>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-heading text-lg text-[color:var(--color-accent)]">Partner</h2>
          <Link href="/me/partner" className="text-xs text-[color:var(--color-text-muted)] underline">
            Edit
          </Link>
        </div>
        {partner ? (() => {
          const p = partner as {
            partner_name: string;
            relationship_label: string | null;
            partner_birthdate: string | null;
            relationship_date: string | null;
            things_loved: string[] | null;
          };
          const loved = (p.things_loved ?? []).filter(Boolean);
          return (
            <div className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
              {/* Header row */}
              <div className="px-5 py-4 flex items-baseline justify-between gap-3 border-b border-[color:var(--color-border)]">
                <p className="font-heading text-xl">{p.partner_name}</p>
                {p.relationship_label ? (
                  <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] px-2 py-1 rounded border border-[color:var(--color-border)]">
                    {p.relationship_label.toUpperCase()}
                  </span>
                ) : null}
              </div>

              {/* Meta grid */}
              {(p.partner_birthdate || p.relationship_date) ? (
                <div className="grid grid-cols-2 gap-4 px-5 py-4 border-b border-[color:var(--color-border)]">
                  <div>
                    <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
                      BIRTHDAY
                    </p>
                    <p className="text-sm mt-1">{fmtDate(p.partner_birthdate)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
                      ANNIVERSARY
                    </p>
                    <p className="text-sm mt-1">{fmtDate(p.relationship_date)}</p>
                  </div>
                </div>
              ) : null}

              {/* Loved list */}
              {loved.length > 0 ? (
                <div className="px-5 py-4">
                  <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-3">
                    WHAT I LOVE
                  </p>
                  <ul className="space-y-2">
                    {loved.map((t, i) => (
                      <li
                        key={i}
                        className="pl-3 border-l-2 border-[color:var(--color-primary)] text-sm leading-snug"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })() : (
          <EmptyState
            title="No partner saved."
            body="Only you see this. Your coach uses it."
            action={<Link href="/me/partner"><Button variant="secondary">Add her</Button></Link>}
          />
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-heading text-lg text-[color:var(--color-accent)]">Kids</h2>
          <Link href="/me/kids" className="text-xs text-[color:var(--color-text-muted)] underline">
            Manage
          </Link>
        </div>
        {(kids ?? []).length === 0 ? (
          <EmptyState title="No kids saved." />
        ) : (
          <ul className="space-y-2">
            {(kids ?? []).map((k) => (
              <li key={k.id} className="p-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
                <p className="font-heading text-sm">{k.name}</p>
                {k.birthdate ? <p className="text-xs text-[color:var(--color-text-muted)]">{k.birthdate as string}</p> : null}
                {((k.things_loved as string[]) ?? []).slice(0, 1).map((t, i) => (
                  <p key={i} className="text-xs text-[color:var(--color-text-muted)] mt-1">&ldquo;{t}&rdquo;</p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border-2 border-[color:var(--color-coach)]">
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-coach)]">
          PARTNER CONNECTION SURVEY
        </p>
        <h2 className="font-heading text-xl mt-1">The sit-down</h2>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1 max-w-md">
          {latestComp !== null
            ? `Latest composite ${latestComp.toFixed(2)}${
                priorComp !== null ? ` (${(latestComp - priorComp).toFixed(2)} vs prior)` : ""
              }`
            : "Ask her the questions. Write her words down."}
        </p>
        <div className="mt-3 flex gap-2">
          <Link href="/me/survey/take">
            <Button variant="coach">Start survey</Button>
          </Link>
          <Link href="/me/survey">
            <Button variant="secondary">History</Button>
          </Link>
        </div>
      </section>

      <form action="/logout" method="post">
        <button
          type="submit"
          className="w-full h-11 rounded-md font-heading text-xs tracking-widest border border-[color:var(--color-border)] text-[color:var(--color-text-muted)]"
        >
          SIGN OUT
        </button>
      </form>
    </div>
  );
}
