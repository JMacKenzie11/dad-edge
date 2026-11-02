import Link from "next/link";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { challengeDates, challengeDayCount, shortDate, targetLine } from "@/lib/challenges/rules";
import type { ChallengeBoard } from "@/lib/challenges/load";
import { ChallengeMembership } from "./challenge-membership";

/**
 * Community > Challenges: one card per challenge in his communities
 * (running and upcoming first, ended ones for 30 days). Each man who's in
 * is ranked by the challenge days he ticked, shown against every day in
 * the challenge. Just a total, nothing to tap: the squares it had looked
 * like boxes to tick, and men tried. A missed day costs him that day; it
 * doesn't take anyone off the board.
 */
export function ChallengesTab({ boards, viewerId, readOnly }: { boards: ChallengeBoard[]; viewerId: string; readOnly: boolean }) {
  return (
    <div className="space-y-5">
      {boards.map((b) => (
        <ChallengeCard key={b.challenge.id} entry={b} viewerId={viewerId} readOnly={readOnly} />
      ))}
      <p className="text-[11px] text-[color:var(--color-text-muted)]">
        The board ranks everyone by days done, out of every day in the challenge. To tick a day, go to your{" "}
        <Link href="/missions" className="underline hover:text-[color:var(--color-primary)]">
          Missions page
        </Link>
        . You can tick it any time until your community locks that week.
      </p>
    </div>
  );
}

function ChallengeCard({ entry, viewerId, readOnly }: { entry: ChallengeBoard; viewerId: string; readOnly: boolean }) {
  const { challenge: c, board, myStatus } = entry;
  const p = PILLAR_BY_CODE[c.pillar_code];
  const totalDays = challengeDayCount(c);
  const status =
    board.phase === "running"
      ? `WEEK ${board.currentWeek ?? 1} OF ${board.weeks.length}`
      : board.phase === "upcoming"
        ? `STARTS ${shortDate(c.starts_on).toUpperCase()}`
        : `ENDED ${shortDate(c.ends_on).toUpperCase()}`;

  return (
    <section
      className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden"
      aria-label={`Challenge: ${c.name}`}
    >
      <header className="px-5 py-4 border-b border-[color:var(--color-border)] space-y-1" style={{ borderLeft: `3px solid ${p.colorVar}` }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[10px] font-heading tracking-widest" style={{ color: p.colorVar }}>
            {p.label.toUpperCase()} · {status}
          </p>
          <p className="text-[11px] text-[color:var(--color-text-muted)]">{challengeDates(c)}</p>
        </div>
        <h2 className="font-heading text-lg leading-tight">{c.name}</h2>
        <p className="text-sm">
          {c.mission_description}
          <span className="text-[color:var(--color-text-muted)]"> · {targetLine(c)}</span>
        </p>
        {board.phase !== "ended" && !readOnly ? (
          <ChallengeMembership challengeId={c.id} joined={myStatus === "in"} />
        ) : null}
      </header>

      {board.rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[color:var(--color-text-muted)]">No one has joined yet.</p>
      ) : (
        <ol className="divide-y divide-[color:var(--color-border)]">
          {board.rows.map((r) => {
            const isMe = r.userId === viewerId;
            return (
              <li
                key={r.userId}
                className={"px-4 sm:px-5 py-3 flex items-center gap-3 " + (isMe ? "bg-[color:var(--color-primary)]/[0.08]" : "")}
              >
                <p className="font-heading text-sm truncate min-w-0 flex-1">
                  {r.name}
                  {isMe ? <span className="ml-1.5 text-[10px] tracking-widest text-[color:var(--color-primary)]">(YOU)</span> : null}
                </p>
                <p className="shrink-0 whitespace-nowrap text-right text-[11px] font-heading tracking-widest">
                  <RowNote row={r} phase={board.phase} totalDays={totalDays} />
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RowNote({
  row,
  phase,
  totalDays,
}: {
  row: ChallengeBoard["board"]["rows"][number];
  phase: ChallengeBoard["board"]["phase"];
  totalDays: number;
}) {
  // Green while he's ticked every day so far (today counts once ticked);
  // a ★ at the end for a man who hit every week's target.
  const onPace = phase === "running" && row.daysDone > 0 && row.daysDone === row.daysSoFar;
  const color = row.finisher
    ? "text-[color:var(--color-accent)]"
    : onPace
      ? "text-[color:var(--color-success)]"
      : "text-[color:var(--color-text-muted)]";
  return (
    <span className={color} data-days-done>
      {row.finisher ? "★ " : ""}
      {row.daysDone} OF {totalDays} DAYS
    </span>
  );
}
