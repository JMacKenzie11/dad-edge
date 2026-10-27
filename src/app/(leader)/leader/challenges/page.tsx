import Link from "next/link";
import { resolveLeaderCommunity } from "@/lib/leader-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/scoring/week";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { CHALLENGE_COLUMNS, addDays, challengeDates, daysNames, mondayOf, targetLine, type Challenge } from "@/lib/challenges/rules";
import { ChallengeForm } from "./challenge-form";
import { createChallenge } from "./actions";

export const dynamic = "force-dynamic";

export default async function LeaderChallengesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; saved?: string; deleted?: string }>;
}) {
  const sp = await searchParams;
  const { user, communityId, communityName } = await resolveLeaderCommunity(sp);
  const supabase = await createSupabaseServerClient();
  const today = localDate(new Date(), user.timezone);

  const { data: rows } = await supabase
    .from("challenges")
    .select(CHALLENGE_COLUMNS)
    .eq("community_id", communityId)
    .order("starts_on", { ascending: false });
  const challenges = (rows ?? []) as Challenge[];
  const { data: parts } = challenges.length
    ? await supabase.from("challenge_participants").select("challenge_id, status").in("challenge_id", challenges.map((c) => c.id))
    : { data: [] };
  const inCount = (id: string) =>
    ((parts ?? []) as { challenge_id: string; status: string }[]).filter((p) => p.challenge_id === id && p.status === "in").length;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl">Challenges</h1>
        <span className="text-xs text-[color:var(--color-text-muted)]">{communityName}</span>
      </header>

      {sp.saved ? <p className="text-xs text-[color:var(--color-success)]">Saved.</p> : null}
      {sp.deleted ? <p className="text-xs text-[color:var(--color-success)]">Deleted.</p> : null}

      <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
        <p className="px-4 py-3 border-b border-[color:var(--color-border)] text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          THIS COMMUNITY&rsquo;S CHALLENGES
        </p>
        {challenges.length === 0 ? (
          <p className="px-4 py-4 text-sm text-[color:var(--color-text-muted)]">No challenges yet. Set the first one below.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border)]">
            {challenges.map((c) => {
              const p = PILLAR_BY_CODE[c.pillar_code];
              const phase = today < c.starts_on ? "UPCOMING" : today > c.ends_on ? "ENDED" : "RUNNING";
              return (
                <li key={c.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="font-heading text-sm">{c.name}</p>
                    <p className="text-xs text-[color:var(--color-text-muted)]">
                      <span style={{ color: p.colorVar }}>{p.label}</span> · {c.mission_description} · {c.days.length === 7 ? targetLine(c) : `${c.target} of ${daysNames(c.days)}`} · {challengeDates(c)}
                    </p>
                  </div>
                  <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">{phase}</span>
                  <span className="text-xs">{inCount(c.id)} in</span>
                  <Link
                    href={`/leader/challenges/${c.id}?c=${communityId}`}
                    className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)] hover:underline"
                  >
                    EDIT
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] max-w-xl space-y-3">
        <div>
          <h2 className="font-heading text-lg">New challenge</h2>
          <p className="text-xs text-[color:var(--color-text-muted)]">
            Members see it on their Today and Missions pages until it ends. Each one who joins gets the mission every week, on these days, for the rest of the challenge.
          </p>
        </div>
        <ChallengeForm
          action={createChallenge}
          communityId={communityId}
          defaultStart={today < addDays(mondayOf(today), 1) ? today : addDays(mondayOf(today), 7)}
          submitLabel="CREATE CHALLENGE"
        />
      </section>
    </div>
  );
}
