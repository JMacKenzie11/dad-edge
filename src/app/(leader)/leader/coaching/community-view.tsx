import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { CommunityPicker } from "@/components/ui/community-picker";
import { recentlyReached, triage, type CoachingMan } from "@/lib/coaching/load";
import type { CoachingCommunity } from "@/lib/coaching/access";
import { MissionStatus } from "@/components/coaching/mission-status";

const card = "rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]";
const label = "text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]";

/**
 * The Coaching page for one community: who to reach out to, who to call
 * out, then every man with his goals, recent missions and flags. Shared by
 * /admin/coaching and /leader/coaching.
 */
export function CoachingCommunityView({
  basePath,
  community,
  communities,
  men,
  showPicker,
}: {
  basePath: string;
  community: CoachingCommunity;
  communities: CoachingCommunity[];
  men: CoachingMan[];
  showPicker: boolean;
}) {
  const { reachOut, callOut, reached } = triage(men);
  const href = (m: CoachingMan) => `${basePath}/${m.userId}?c=${community.id}`;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl">Coaching</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] max-w-xl">
            Who needs you this week, and a question to open with. Only leaders and admins see this page.
          </p>
        </div>
        {showPicker ? <CommunityPicker communities={communities} current={community.id} /> : (
          <span className="text-xs text-[color:var(--color-text-muted)]">{community.name}</span>
        )}
      </header>

      {men.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">No members in {community.name} yet.</p>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            <div className={`${card} p-4`}>
              <p className={label}>REACH OUT</p>
              {reachOut.length === 0 ? (
                <p className="text-sm text-[color:var(--color-text-muted)] mt-2">Nobody needs a nudge this week.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {reachOut.slice(0, 8).map((m) => (
                    <li key={m.userId}>
                      <Link href={href(m)} className="font-heading text-sm hover:text-[color:var(--color-accent)]">{m.name}</Link>
                      <p className="text-xs text-[color:var(--color-text-muted)]">{m.signals.flags[0].line}</p>
                      <p className="text-xs mt-0.5">Ask: &ldquo;{m.signals.flags[0].question}&rdquo;</p>
                    </li>
                  ))}
                </ul>
              )}
              {reached.length > 0 ? (
                <p className="text-xs text-[color:var(--color-text-muted)] mt-3">
                  Reached out this week: {reached.map((m) => m.name).join(", ")}.
                </p>
              ) : null}
            </div>
            <div className={`${card} p-4`}>
              <p className={label}>CALL OUT</p>
              {callOut.length === 0 ? (
                <p className="text-sm text-[color:var(--color-text-muted)] mt-2">No wins to name yet this week.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {callOut.slice(0, 8).map((m) => (
                    <li key={m.userId}>
                      <Link href={href(m)} className="font-heading text-sm hover:text-[color:var(--color-accent)]">{m.name}</Link>
                      <p className="text-xs text-[color:var(--color-text-muted)]">{m.signals.wins.map((w) => w.line).join(" ")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <p className={label}>EVERY MAN IN {community.name.toUpperCase()}</p>
            {[...men].sort((a, b) => b.signals.weight - a.signals.weight || a.name.localeCompare(b.name)).map((m) => (
              // aria-label names the link: the card body is its own component so
              // the help extractor doesn't take a line of card text as the label.
              <Link key={m.userId} href={href(m)} aria-label={`Open ${m.name}`} className={`${card} block p-4 hover:border-[color:var(--color-accent)]`}>
                <ManCard man={m} />
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

/** One man's card on the Coaching page. */
function ManCard({ man: m }: { man: CoachingMan }) {
  const reachedOut = recentlyReached(m);
  const r = m.signals.recent;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-heading text-base">{m.name}</p>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          {m.lastCheckin ? `Last check-in ${m.lastCheckin}` : "No check-ins yet"}
          {r.total > 0 ? ` · ${r.done} of ${r.total} missions done, last 4 weeks` : ""}
          {reachedOut ? ` · Reached out ${formatDistanceToNowStrict(new Date(reachedOut.created_at))} ago` : ""}
        </p>
      </div>

      {m.goals.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)] mt-2">No goals this quarter.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {m.goals.filter((g) => g.status !== "abandoned").map((g) => (
            <li key={g.id} className="text-sm">
              <span className="font-heading text-xs mr-2" style={{ color: PILLAR_BY_CODE[g.focus_area].colorVar }}>
                {PILLAR_BY_CODE[g.focus_area].label.toUpperCase()}
              </span>
              {g.desired_end_state}
              {g.status !== "active" ? <span className="text-xs text-[color:var(--color-text-muted)]"> · {g.status === "completed" ? "completed" : "quarter review"}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {m.missions.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {m.missions.slice(0, 6).map((x) => (
            <li key={x.id} className="text-xs text-[color:var(--color-text-muted)]">
              <MissionStatus mission={x} /> {x.description.length > 48 ? `${x.description.slice(0, 47)}…` : x.description}
            </li>
          ))}
        </ul>
      ) : null}

      {m.signals.flags.length + m.signals.wins.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.signals.flags.map((f, i) => (
            <span key={`f${i}`} className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: f.severity >= 2 ? "var(--color-danger)" : "var(--color-border)" }}>
              {f.line}
            </span>
          ))}
          {m.signals.wins.map((w, i) => (
            <span key={`w${i}`} className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--color-success)" }}>
              {w.line}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
