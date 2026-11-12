import { createHash } from "node:crypto";
import { selectAll } from "@/lib/supabase/select-all";
import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { utilityModel, utilityModelIdOrUnset } from "@/lib/model-config";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import type { FitVerdict } from "./signals";

/**
 * Does a goal-linked mission move that goal forward? Judged by the
 * utility model for the admin and leader Coaching pages ONLY.
 *
 * This is the one place the app judges a man's choice of mission, and it
 * is never shown to him: the coach, the mission scorer and every member
 * page stay out of it (memory "coach judges the writing, not the choice";
 * Jason chose to try it for leaders on 2026-11-10, DECISIONS.md "Coaching
 * view"). A source guard keeps this module and its table out of member
 * routes.
 *
 * The model returns a verdict only. Leaders see a fixed label per verdict,
 * not model prose, so there's nothing to drift.
 */

export const FIT_VERDICTS = ["moves_it", "related", "no_link"] as const;

export const FIT_LABEL: Record<FitVerdict, string> = {
  moves_it: "Moves the goal",
  related: "Loosely related",
  no_link: "No clear link",
};

export type FitInput = {
  missionId: string;
  goalId: string;
  description: string;
  focus_area: PillarCode;
  desired_end_state: string;
  current_state: string | null;
};

const SYSTEM = `You help a men's coaching group leader see whether a man's weekly missions are moving his quarterly goal forward. The man never sees your answer; the leader uses it to decide what to ask him.

You get one goal and one mission he linked to it. Answer with one verdict:

- moves_it: doing this mission is a direct step toward the end state. A reader would say "yes, that's how you get there". Practice, training, outreach, building the habit, or removing an obstacle the goal names all count.
- related: it's in the same area of life and could help, but it doesn't clearly move this particular end state. For example, a general fitness mission under a specific strength goal.
- no_link: you can't see how doing it gets him closer to this end state.

Judge the connection, not the quality of the writing and not whether you'd have picked it. When in doubt between two verdicts, choose the kinder one: moves_it over related, related over no_link. Return JSON only.`;

const SchemaZ = z.object({ verdict: z.enum(FIT_VERDICTS) });

export function fitInputHash(i: Omit<FitInput, "missionId" | "goalId">): string {
  return createHash("sha256")
    .update(JSON.stringify([i.description.trim(), i.focus_area, i.desired_end_state.trim(), (i.current_state ?? "").trim()]))
    .digest("hex")
    .slice(0, 32);
}

export function fitPrompt(i: FitInput): string {
  const p = PILLAR_BY_CODE[i.focus_area];
  return `Goal domain: ${p.label} (${p.domain})
Goal end state: """${i.desired_end_state.trim()}"""
Where he's starting from: ${i.current_state?.trim() ? `"""${i.current_state.trim()}"""` : "not written"}

Mission linked to this goal: """${i.description.trim()}"""

Return JSON only.`;
}

export async function judgeFit(i: FitInput): Promise<FitVerdict | null> {
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: SchemaZ,
      system: SYSTEM,
      prompt: fitPrompt(i),
      temperature: 0,
      maxOutputTokens: 50,
    });
    return object.verdict;
  } catch (err) {
    console.error("mission-goal fit check failed", err);
    return null;
  }
}

type Row = {
  id: string;
  description: string;
  quarterly_goal_id: string;
  goal:
    | { id: string; focus_area: PillarCode; desired_end_state: string; current_state: string | null }
    | { id: string; focus_area: PillarCode; desired_end_state: string; current_state: string | null }[]
    | null;
};

/**
 * Judge every goal-linked mission for these men, from `from` onwards,
 * that has no verdict yet or whose wording or goal changed since. Needs
 * the service client: mission_goal_fit has no browser policies.
 */
export async function judgeMissingFits(
  svc: SupabaseClient,
  opts: { userIds: string[]; from: string; limit?: number; concurrency?: number },
): Promise<{ judged: number; failed: number; pending: number }> {
  if (opts.userIds.length === 0) return { judged: 0, failed: 0, pending: 0 };
  const { data } = await selectAll((lo, hi) => svc
    .from("missions")
    .select("id, description, quarterly_goal_id, goal:quarterly_goal_id(id, focus_area, desired_end_state, current_state)")
    .in("user_id", opts.userIds)
    .not("quarterly_goal_id", "is", null)
    .gte("target_date", opts.from)
    .order("id")
    .range(lo, hi));
  const rows = ((data ?? []) as Row[])
    .map((r) => ({ r, g: Array.isArray(r.goal) ? r.goal[0] : r.goal }))
    .filter((x): x is { r: Row; g: NonNullable<typeof x.g> } => !!x.g);
  if (rows.length === 0) return { judged: 0, failed: 0, pending: 0 };

  const { data: existing } = await svc
    .from("mission_goal_fit")
    .select("mission_id, input_hash")
    .in("mission_id", rows.map((x) => x.r.id));
  const have = new Map(((existing ?? []) as { mission_id: string; input_hash: string }[]).map((e) => [e.mission_id, e.input_hash]));

  const todo = rows
    .map(({ r, g }) => {
      const input: FitInput = {
        missionId: r.id,
        goalId: g.id,
        description: r.description,
        focus_area: g.focus_area,
        desired_end_state: g.desired_end_state,
        current_state: g.current_state,
      };
      return { input, hash: fitInputHash(input) };
    })
    .filter((t) => have.get(t.input.missionId) !== t.hash);

  const batch = todo.slice(0, opts.limit ?? todo.length);
  let judged = 0;
  let failed = 0;
  const model = utilityModelIdOrUnset();
  const workers = Math.max(1, opts.concurrency ?? 4);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, batch.length) }, async () => {
      while (next < batch.length) {
        const t = batch[next++];
        const verdict = await judgeFit(t.input);
        if (!verdict) {
          failed += 1;
          continue;
        }
        const { error } = await svc.from("mission_goal_fit").upsert(
          { mission_id: t.input.missionId, goal_id: t.input.goalId, verdict, input_hash: t.hash, model, judged_at: new Date().toISOString() },
          { onConflict: "mission_id" },
        );
        if (error) failed += 1;
        else judged += 1;
      }
    }),
  );
  return { judged, failed, pending: todo.length - batch.length };
}
