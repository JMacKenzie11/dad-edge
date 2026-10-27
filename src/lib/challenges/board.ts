import { addDays, challengeWeeks, mondayOf, type Challenge } from "./rules";

/**
 * The community board for one challenge: each man who's in, one square
 * per week. A week counts when that week's challenge mission is
 * completed. Missing a week doesn't put him out; he keeps going and the
 * board shows the miss.
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

export type BoardMission = { user_id: string; target_date: string; status: string };
export type BoardParticipant = { user_id: string; status: string; name: string };

export type BoardRow = {
  userId: string;
  name: string;
  weeks: WeekState[];
  done: number;
  missed: number;
  /** No missed weeks so far. */
  perfect: boolean;
  /** The challenge is over and he hit every week he had. */
  finisher: boolean;
  thisWeek: WeekState | null;
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
      return {
        userId: p.user_id,
        name: p.name,
        weeks: states,
        done,
        missed,
        perfect: missed === 0,
        finisher: phase === "ended" && missed === 0 && done > 0,
        thisWeek: currentIdx >= 0 ? states[currentIdx] : null,
      };
    })
    .sort((a, b) => {
      if (a.perfect !== b.perfect) return a.perfect ? -1 : 1;
      if (b.done !== a.done) return b.done - a.done;
      return a.name.localeCompare(b.name);
    });

  return { phase, weeks, currentWeek: currentIdx >= 0 ? currentIdx + 1 : null, rows };
}
