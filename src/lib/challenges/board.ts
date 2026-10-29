import { addDays, challengeWeeks, mondayOf, type Challenge } from "./rules";

/**
 * The community board for one challenge: each man who's in, tallied by
 * the day. His score is the challenge days he ticked; missing a day costs
 * him that day, not the week. Each week still gets a square, showing the
 * days he ticked in it and whether he hit that week's target (his
 * challenge mission completes itself when he does). Missing days doesn't
 * put him out; he keeps going and the board shows it.
 */

export type WeekState =
  /** That week's mission is completed. */
  | "done"
  /** The week is over and its mission wasn't completed. */
  | "missed"
  /** This week, not completed yet. */
  | "open"
  /** A week still to come. */
  | "upcoming"
  /** No mission that week: before he joined, or none of the days were left. */
  | "none";

export type BoardMission = {
  user_id: string;
  target_date: string;
  status: string;
  target_dates?: string[] | null;
  done_dates?: string[] | null;
};
export type BoardParticipant = { user_id: string; status: string; name: string };

export type BoardRow = {
  userId: string;
  name: string;
  weeks: WeekState[];
  done: number;
  missed: number;
  /** The challenge is over and he hit every week he had. */
  finisher: boolean;
  thisWeek: WeekState | null;
  /** Days ticked in each week, one per square. */
  weekTicks: number[];
  /** Challenge days he ticked. */
  daysDone: number;
  /** His challenge days before today, plus today once ticked (all of
   *  them once it's over). */
  daysSoFar: number;
  /** All his challenge days, from when he joined to the end. */
  daysTotal: number;
};

export type Board = {
  phase: "upcoming" | "running" | "ended";
  weeks: string[];
  /** 1-based index of this week, null when it isn't running. */
  currentWeek: number | null;
  rows: BoardRow[];
};

export function buildBoard(input: {
  challenge: Pick<Challenge, "starts_on" | "ends_on">;
  participants: BoardParticipant[];
  missions: BoardMission[];
  /** The viewer's date, yyyy-MM-dd. */
  today: string;
}): Board {
  const { challenge, today } = input;
  const weeks = challengeWeeks(challenge.starts_on, challenge.ends_on);
  const thisMonday = mondayOf(today);
  const phase = today < challenge.starts_on ? "upcoming" : today > challenge.ends_on ? "ended" : "running";
  const currentIdx = phase === "running" ? weeks.indexOf(thisMonday) : -1;

  const byUserWeek = new Map<string, BoardMission>();
  for (const m of input.missions) byUserWeek.set(`${m.user_id}|${mondayOf(m.target_date)}`, m);

  const rows = input.participants
    .filter((p) => p.status === "in")
    .map((p): BoardRow => {
      const states = weeks.map((monday): WeekState => {
        const m = byUserWeek.get(`${p.user_id}|${monday}`);
        if (!m) return "none";
        if (m.status === "completed") return "done";
        const weekOver = addDays(monday, 6) < today;
        if (weekOver) return "missed";
        return monday === thisMonday ? "open" : "upcoming";
      });
      const done = states.filter((s) => s === "done").length;
      const missed = states.filter((s) => s === "missed").length;
      const mine = weeks.map((monday) => byUserWeek.get(`${p.user_id}|${monday}`));
      const days = mine.flatMap((m) => m?.target_dates ?? []);
      const weekTicks = mine.map((m) => m?.done_dates?.length ?? 0);
      const ticked = new Set(mine.flatMap((m) => m?.done_dates ?? []));
      return {
        userId: p.user_id,
        name: p.name,
        weeks: states,
        done,
        missed,
        finisher: phase === "ended" && missed === 0 && done > 0,
        thisWeek: currentIdx >= 0 ? states[currentIdx] : null,
        weekTicks,
        daysDone: weekTicks.reduce((a, b) => a + b, 0),
        // Today only counts against him once he's ticked it.
        daysSoFar: days.filter((d) => d < today || ticked.has(d)).length,
        daysTotal: days.length,
      };
    })
    .sort((a, b) => b.daysDone - a.daysDone || a.name.localeCompare(b.name));

  return { phase, weeks, currentWeek: currentIdx >= 0 ? currentIdx + 1 : null, rows };
}
