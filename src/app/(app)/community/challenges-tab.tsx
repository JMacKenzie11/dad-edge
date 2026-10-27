import { PILLAR_BY_CODE } from "@/lib/pillars";
import { challengeDates, shortDate, targetLine } from "@/lib/challenges/rules";
import type { ChallengeBoard } from "@/lib/challenges/load";
import type { WeekState } from "@/lib/challenges/board";
import { ChallengeMembership } from "./challenge-membership";

/**
 * Community > Challenges: one card per challenge in his communities
 * (running and upcoming first, ended ones for 30 days). Each man who's in
 * gets a row of squares, one per week. The ones still perfect sort to
 * the top; a miss doesn't take anyone off the board.
 */
export function ChallengesTab({ boards, viewerId, readOnly }: { boards: ChallengeBoard[]; viewerId: string; readOnly: boolean }) {
  return (
    <div className="space-y-5">
      {boards.map((b) => (
        <ChallengeCard key={b.challenge.id} entry={b} viewerId={viewerId} readOnly={readOnly} />
      ))}
      <p className="text-[11px] text-[color:var(--color-text-muted)]">
        Each square is one week. A week counts when that week&rsquo;s challenge mission is marked complete.
      </p>
    </div>
  );
}

function ChallengeCard({ entry, viewerId, readOnly }: { entry: ChallengeBoard; viewerId: string; readOnly: boolean }) {
  const { challenge: c, board, myStatus } = entry;
  const p = PILLAR_BY_CODE[c.pillar_code];
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
                <div className="flex flex-wrap gap-1 justify-end" aria-label={`${r.done} of ${board.weeks.length} weeks hit`}>
                  {r.weeks.map((w, i) => (
                    <WeekSquare key={i} state={w} week={i + 1} />
                  ))}
                </div>
                <p className="w-[96px] shrink-0 text-right text-[10px] font-heading tracking-widest">
                  <RowNote row={r} phase={board.phase} />
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const SQUARE_LABEL: Record<WeekState, string> = {
  done: "hit",
  missed: "missed",
  open: "this week, not complete yet",
  upcoming: "still to come",
  none: "not in yet",
};

function WeekSquare({ state, week }: { state: WeekState; week: number }) {
  const style: React.CSSProperties =
    state === "done"
      ? { background: "var(--color-accent)", borderColor: "var(--color-accent)" }
      : state === "missed"
        ? { borderColor: "var(--color-danger)" }
        : state === "open"
          ? { borderColor: "var(--color-primary)" }
          : state === "none"
            ? { borderColor: "transparent", background: "var(--color-border)", opacity: 0.35 }
            : { borderColor: "var(--color-border)" };
  return (
    <span
      className="inline-block h-4 w-4 rounded-[3px] border-2"
      style={style}
      title={`Week ${week}: ${SQUARE_LABEL[state]}`}
      data-week-state={state}
    />
  );
}

function RowNote({ row, phase }: { row: ChallengeBoard["board"]["rows"][number]; phase: ChallengeBoard["board"]["phase"] }) {
  if (phase === "ended") {
    return row.finisher ? (
      <span className="text-[color:var(--color-accent)]">★ FINISHER</span>
    ) : (
      <span className="text-[color:var(--color-text-muted)]">{row.done} WEEKS HIT</span>
    );
  }
  if (row.thisWeek === "done") return <span className="text-[color:var(--color-success)]">DONE THIS WEEK</span>;
  if (row.thisWeek === "open") return <span className="text-[color:var(--color-text-muted)]">NOT YET</span>;
  return null;
}
