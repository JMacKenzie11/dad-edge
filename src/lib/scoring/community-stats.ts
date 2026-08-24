import { addDays, format } from "date-fns";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { deriveA2ForDate } from "@/lib/scoring/action";
import { localMonday, weekDates } from "@/lib/scoring/week";

export type RawCheckin = {
  user_id: string;
  date: string;
  pillar_code: PillarCode;
  value: 0 | 1;
};

export type RawMission = {
  user_id: string;
  target_date: string;
  status: string;
  completed_late: boolean;
  quality_score: number | null;
};

export type Member = {
  user_id: string;
  name: string;
  role: "member" | "leader";
  status: "active" | "inactive";
};

export type MemberStats = {
  userId: string;
  name: string;
  role: "member" | "leader";

  // This week
  weekTotal: number; // 0..49 (7 daily-checkable pillars × 7 days; excludes Action)
  weekTotalPrev: number;
  weekMissionsCompleted: number;
  weekMissionsPlanned: number; // total missions with target_date in the week (any status)
  weekMissionsAttempted: number; // completed + missed
  weekMissionsOnTimeRate: number; // 0..1

  // 4-week rolling
  fourWeekTotal: number; // 0..(49*4)
  fourWeekMissionsCompleted: number;
  fourWeekMissionsAttempted: number;
  fourWeekMissionsOnTimeRate: number;

  // Quality
  avgQualityScore: number | null;
  qualityScoredCount: number;

  // Streaks (ending today)
  engagementStreak: number;
  perPillarStreak: Record<PillarCode, number>;
};

export type CommunityStats = {
  weekMonday: string;
  weekDates: string[];
  prevWeekMonday: string;
  fourWeekStart: string;
  members: MemberStats[];
  pillarKings: Record<PillarCode, { userId: string; name: string; score: number } | null>;
};

/**
 * Roll a community's raw check-ins + missions into everything the leaderboards
 * on /community need. Computed server-side once, passed to display components.
 * Weekly windows are anchored to the community timezone.
 */
export function computeCommunityStats(opts: {
  members: Member[];
  checkins: RawCheckin[];
  missions: RawMission[];
  timezone: string;
  now?: Date;
}): CommunityStats {
  const now = opts.now ?? new Date();
  const monday = localMonday(now, opts.timezone);
  const week = weekDates(monday);
  const prevMondayDate = addDays(new Date(`${monday}T00:00:00`), -7);
  const prevMonday = format(prevMondayDate, "yyyy-MM-dd");
  const prevWeek = weekDates(prevMonday);
  const fourWeekStart = format(addDays(new Date(`${monday}T00:00:00`), -21), "yyyy-MM-dd");
  const fourWeekDates: string[] = [];
  for (let i = 0; i < 28; i++) {
    fourWeekDates.push(format(addDays(new Date(`${fourWeekStart}T00:00:00`), i), "yyyy-MM-dd"));
  }

  // Index check-ins per user.
  const checkinsByUser = new Map<string, RawCheckin[]>();
  for (const m of opts.members) checkinsByUser.set(m.user_id, []);
  for (const c of opts.checkins) {
    if (c.pillar_code === "A2") continue; // derived only
    checkinsByUser.get(c.user_id)?.push(c);
  }

  // Index missions per user.
  const missionsByUser = new Map<string, RawMission[]>();
  for (const m of opts.members) missionsByUser.set(m.user_id, []);
  for (const mission of opts.missions) missionsByUser.get(mission.user_id)?.push(mission);

  const memberStats: MemberStats[] = opts.members.map((m) => {
    const rows = checkinsByUser.get(m.user_id) ?? [];
    const missions = missionsByUser.get(m.user_id) ?? [];

    // Build a set of (date, pillar) with value=1 for streaks + totals.
    // A2 is NOT counted in the weekly total (Action is scored via
    // completed-mission count, separate from the daily-pillars total).
    const doneSet = new Set<string>();
    for (const r of rows) {
      if (r.value === 1 && r.pillar_code !== "A2") {
        doneSet.add(`${r.date}|${r.pillar_code}`);
      }
    }
    const missionsInWindow = missions.filter(
      (mn) => mn.target_date >= fourWeekStart && mn.target_date <= week[6],
    );

    // Weekly totals — 7 daily pillars only, max 49 per week.
    const weekTotal = totalForWindow(doneSet, week);
    const weekTotalPrev = totalForWindow(doneSet, prevWeek);
    const fourWeekTotal = totalForWindow(doneSet, fourWeekDates);

    // Missions this week.
    const thisWeekMissions = missions.filter(
      (mn) => mn.target_date >= week[0] && mn.target_date <= week[6],
    );
    const weekCompleted = thisWeekMissions.filter((mn) => mn.status === "completed").length;
    const weekMissed = thisWeekMissions.filter((mn) => mn.status === "missed").length;
    const weekAttempted = weekCompleted + weekMissed;
    const weekPlanned = thisWeekMissions.length;
    const weekOnTime = thisWeekMissions.filter(
      (mn) => mn.status === "completed" && !mn.completed_late,
    ).length;
    const weekOnTimeRate = weekCompleted > 0 ? weekOnTime / weekCompleted : 0;

    // Missions 4-week.
    const fourWeekMissions = missions.filter(
      (mn) => mn.target_date >= fourWeekStart && mn.target_date <= week[6],
    );
    const fwCompleted = fourWeekMissions.filter((mn) => mn.status === "completed").length;
    const fwMissed = fourWeekMissions.filter((mn) => mn.status === "missed").length;
    const fwAttempted = fwCompleted + fwMissed;
    const fwOnTime = fourWeekMissions.filter(
      (mn) => mn.status === "completed" && !mn.completed_late,
    ).length;
    const fwOnTimeRate = fwCompleted > 0 ? fwOnTime / fwCompleted : 0;

    // Quality average across missions with a score in the 4-week window.
    const scored = fourWeekMissions.filter((mn) => mn.quality_score !== null && mn.quality_score !== undefined);
    const avgQuality = scored.length > 0
      ? scored.reduce((s, mn) => s + (mn.quality_score ?? 0), 0) / scored.length
      : null;

    // Streaks.
    const daysWithAnyLog = new Set<string>();
    for (const r of rows) daysWithAnyLog.add(r.date);
    for (const d of fourWeekDates) {
      const a2 = deriveA2ForDate(missionsInWindow, d);
      if (a2 !== null) daysWithAnyLog.add(d);
    }
    const engagementStreak = streakEndingAt(daysWithAnyLog, format(now, "yyyy-MM-dd"));

    const perPillarStreak = {} as Record<PillarCode, number>;
    for (const p of PILLARS) {
      const daysForPillar = new Set<string>();
      if (p.code === "A2") {
        for (const d of fourWeekDates) {
          const a2 = deriveA2ForDate(missionsInWindow, d);
          if (a2 === 1) daysForPillar.add(d);
        }
      } else {
        for (const r of rows) if (r.value === 1 && r.pillar_code === p.code) daysForPillar.add(r.date);
      }
      perPillarStreak[p.code] = streakEndingAt(daysForPillar, format(now, "yyyy-MM-dd"));
    }

    return {
      userId: m.user_id,
      name: m.name,
      role: m.role,
      weekTotal,
      weekTotalPrev,
      weekMissionsCompleted: weekCompleted,
      weekMissionsPlanned: weekPlanned,
      weekMissionsAttempted: weekAttempted,
      weekMissionsOnTimeRate: weekOnTimeRate,
      fourWeekTotal,
      fourWeekMissionsCompleted: fwCompleted,
      fourWeekMissionsAttempted: fwAttempted,
      fourWeekMissionsOnTimeRate: fwOnTimeRate,
      avgQualityScore: avgQuality,
      qualityScoredCount: scored.length,
      engagementStreak,
      perPillarStreak,
    };
  });

  // Pillar kings — top scorer per pillar this week.
  const pillarKings = {} as Record<PillarCode, { userId: string; name: string; score: number } | null>;
  for (const p of PILLARS) {
    let best: { userId: string; name: string; score: number } | null = null;
    for (const s of memberStats) {
      let score = 0;
      if (p.code === "A2") {
        const missions = missionsByUser.get(s.userId) ?? [];
        for (const d of week) {
          const a2 = deriveA2ForDate(missions, d);
          if (a2 === 1) score += 1;
        }
      } else {
        const rows = checkinsByUser.get(s.userId) ?? [];
        for (const r of rows) {
          if (week.includes(r.date) && r.pillar_code === p.code && r.value === 1) score += 1;
        }
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { userId: s.userId, name: s.name, score };
      }
    }
    pillarKings[p.code] = best;
  }

  return {
    weekMonday: monday,
    weekDates: week,
    prevWeekMonday: prevMonday,
    fourWeekStart,
    members: memberStats,
    pillarKings,
  };
}

function totalForWindow(doneSet: Set<string>, days: string[]): number {
  let n = 0;
  for (const d of days) {
    for (const p of PILLARS) {
      if (doneSet.has(`${d}|${p.code}`)) n += 1;
    }
  }
  return n;
}

function streakEndingAt(days: Set<string>, todayISO: string): number {
  let streak = 0;
  const cursor = new Date(`${todayISO}T00:00:00`);
  while (true) {
    const key = format(cursor, "yyyy-MM-dd");
    if (days.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}

/**
 * Compare each member's rank in an ordered list vs a prior-week list.
 * Returns a map of userId → delta (positive = moved up).
 */
export function rankDeltas(
  current: { userId: string }[],
  prior: { userId: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const priorRank = new Map<string, number>();
  prior.forEach((r, i) => priorRank.set(r.userId, i));
  current.forEach((r, i) => {
    const p = priorRank.get(r.userId);
    if (p === undefined) out[r.userId] = 0;
    else out[r.userId] = p - i;
  });
  return out;
}
