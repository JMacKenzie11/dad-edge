import Link from "next/link";
import { addDays, format, parseISO } from "date-fns";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { FIT_LABEL } from "@/lib/coaching/fit";
import type { CoachingMan, CoachingWindow } from "@/lib/coaching/load";
import type { CoachingCommunity } from "@/lib/coaching/access";
import { MissionStatus } from "@/components/coaching/mission-status";
import { FitRefresher } from "@/components/coaching/fit-refresher";

const card = "rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]";
const label = "text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]";
const FIT_COLOR = { moves_it: "var(--color-success)", related: "var(--color-text-muted)", no_link: "var(--color-danger)" } as const;

/** One man on the Coaching page: what to ask, wins, his goals, eight weeks of missions. The page adds the reach-out log. */
export function CoachingManView({
  basePath,
  community,
  man,
  window,
}: {
  basePath: string;
  community: CoachingCommunity;
  man: CoachingMan;
  window: CoachingWindow;
}) {
  const goalById = new Map(man.goals.map((g) => [g.id, g]));
  const linkedUnjudged = man.missions.filter((m) => m.quarterly_goal_id && goalById.has(m.quarterly_goal_id) && !man.fit.has(m.id)).length;

  // Weeks, newest first: next week, this week, then eight back.
  const weeks = Array.from({ length: 10 }, (_, i) => format(addDays(parseISO(`${window.weekStart}T00:00:00`), 7 * (1 - i)), "yyyy-MM-dd"));
  const missionsIn = (monday: string) => {
    const sunday = format(addDays(parseISO(`${monday}T00:00:00`), 6), "yyyy-MM-dd");
    return man.missions.filter((m) => m.target_date >= monday && m.target_date <= sunday);
  };
  const weekName = (monday: string) =>
    monday === window.weekStart ? "THIS WEEK" : monday > window.weekStart ? "NEXT WEEK" : `WEEK OF ${format(parseISO(`${monday}T00:00:00`), "MMM d").toUpperCase()}`;

  return (
    <div className="space-y-6">
      <Link href={`${basePath}?c=${community.id}`} className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
        ← {community.name}
      </Link>
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl">{man.name}</h1>
          <p className="text-xs text-[color:var(--color-text-muted)]">
            {man.lastCheckin ? `Last check-in ${man.lastCheckin}` : "No check-ins yet"}
            {man.signals.recent.total > 0 ? ` · ${man.signals.recent.done} of ${man.signals.recent.total} missions done, last 4 weeks` : ""}
          </p>
        </div>
        <Link
          href={`/messages/with/${man.userId}`}
          className="h-9 px-4 inline-flex items-center rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest"
        >
          MESSAGE HIM
        </Link>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className={`${card} p-4`}>
          <p className={label}>WHAT TO ASK</p>
          {man.signals.flags.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)] mt-2">Nothing flagged. A quick check-in still lands.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {man.signals.flags.map((f, i) => (
                <li key={i}>
                  <p className="text-xs text-[color:var(--color-text-muted)]">{f.line}</p>
                  <p className="text-sm">&ldquo;{f.question}&rdquo;</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={`${card} p-4`}>
          <p className={label}>WINS TO NAME</p>
          {man.signals.wins.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)] mt-2">None yet this month.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {man.signals.wins.map((w, i) => <li key={i} className="text-sm">{w.line}</li>)}
            </ul>
          )}
        </div>
      </section>

      <section className={`${card} p-4`}>
        <p className={label}>GOALS THIS QUARTER</p>
        {man.goals.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] mt-2">No goals this quarter.</p>
        ) : (
          <ul className="mt-2 space-y-4">
            {man.goals.map((g) => (
              <li key={g.id}>
                <p className="text-sm">
                  <span className="font-heading text-xs mr-2" style={{ color: PILLAR_BY_CODE[g.focus_area].colorVar }}>
                    {PILLAR_BY_CODE[g.focus_area].label.toUpperCase()}
                  </span>
                  {g.desired_end_state}
                  <span className="text-xs text-[color:var(--color-text-muted)]"> · {g.status === "needs_review" ? "quarter review" : g.status}</span>
                </p>
                <p className="text-xs text-[color:var(--color-text-muted)] mt-1">Starting point: {g.current_state?.trim() || "not written"}</p>
                {g.midpoint_check_answer ? <p className="text-xs mt-1">Midpoint: &ldquo;{g.midpoint_check_answer}&rdquo;</p> : null}
                {g.retrospective_what_happened ? <p className="text-xs mt-1">Look back: &ldquo;{g.retrospective_what_happened}&rdquo;</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${card} p-4`}>
        <div className="flex items-baseline justify-between">
          <p className={label}>MISSIONS</p>
          <FitRefresher communityId={community.id} memberId={man.userId} pending={linkedUnjudged} />
        </div>
        <div className="mt-2 space-y-4">
          {weeks.map((w) => {
            const list = missionsIn(w);
            if (list.length === 0 && w !== window.weekStart) return null;
            return (
              <div key={w}>
                <p className={label}>{weekName(w)}</p>
                {list.length === 0 ? (
                  <p className="text-xs text-[color:var(--color-text-muted)] mt-1">Nothing planned.</p>
                ) : (
                  <ul className="mt-1 space-y-1.5">
                    {list.map((m) => {
                      const g = m.quarterly_goal_id ? goalById.get(m.quarterly_goal_id) : undefined;
                      const verdict = man.fit.get(m.id);
                      return (
                        <li key={m.id} className="text-sm">
                          <MissionStatus mission={m} /> {m.description}
                          <span className="block text-xs text-[color:var(--color-text-muted)]">
                            <span style={{ color: PILLAR_BY_CODE[m.pillar_code].colorVar }}>{PILLAR_BY_CODE[m.pillar_code].label}</span>
                            {g ? ` · for "${g.desired_end_state}"` : ""}
                            {verdict ? <> · <span style={{ color: FIT_COLOR[verdict] }}>{FIT_LABEL[verdict]}</span></> : null}
                            {m.quality_score !== null ? ` · written ${m.quality_score}/10` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
