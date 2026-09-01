"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateMissionConcreteness } from "@/lib/validation/mission";
import { resolveTargetDates, shiftDatesByOneWeek } from "./target-dates";
import { captureServerEvent } from "@/lib/analytics/server";

const PillarCodeSchema = z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]);

const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateSchema = z.object({
  community_id: z.string().uuid(),
  pillar_code: PillarCodeSchema,
  description: z.string().min(1).max(280),
  // Multi-day missions: array of dates, at least one. Callers that
  // still pass a single target_date get it wrapped into a 1-element
  // array. target_date is written as the max (deadline) of the set
  // for backwards compat with downstream jobs and views.
  target_dates: z.array(DateStringSchema).min(1).max(7).optional(),
  target_date: DateStringSchema.optional(),
  quarterly_goal_id: z.string().uuid().nullable(),
  quality_score: z.number().int().min(0).max(10).nullable().optional(),
}).refine(
  (v) => v.target_dates !== undefined || v.target_date !== undefined,
  { message: "target_dates or target_date required." },
);

const UpdateSchema = z.object({
  mission_id: z.string().uuid(),
  patch: z
    .object({
      description: z.string().min(1).max(280).optional(),
      target_dates: z.array(DateStringSchema).min(1).max(7).optional(),
      target_date: DateStringSchema.optional(),
      quality_score: z.number().int().min(0).max(10).nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: "Empty patch." }),
});

// resolveTargetDates moved to ./target-dates.ts — this file is
// "use server", which forbids exporting non-async helpers.

export async function createMission(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };

  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };
  const data = parsed.data;

  const resolved = resolveTargetDates(data);
  if (!resolved) return { ok: false, error: "Pick at least one day." };

  const gate = validateMissionConcreteness({
    description: data.description,
    target_date: resolved.deadline,
  });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from("missions")
    .insert({
      user_id: user.id,
      community_id: data.community_id,
      pillar_code: data.pillar_code,
      description: data.description.trim(),
      target_date: resolved.deadline,
      target_dates: resolved.dates,
      quarterly_goal_id: data.quarterly_goal_id,
      created_by: "user",
      quality_score: data.quality_score ?? null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  captureServerEvent(user.id, {
    name: "mission_created",
    props: { pillar_code: data.pillar_code, source: "user" },
  });
  revalidatePath("/missions");
  revalidatePath("/today");
  return { ok: true, id: inserted!.id };
}

export async function updateMission(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };

  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };
  const { mission_id, patch } = parsed.data;

  const wantsDateChange =
    patch.target_dates !== undefined || patch.target_date !== undefined;

  let resolvedNext: { dates: string[]; deadline: string } | null = null;
  if (patch.description !== undefined || wantsDateChange) {
    const supabase = await createSupabaseServerClient();
    const { data: existing } = await supabase
      .from("missions")
      .select("description, target_date, target_dates")
      .eq("id", mission_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) return { ok: false, error: "Not found." };
    const row = existing as {
      description: string;
      target_date: string;
      target_dates: string[] | null;
    };
    const nextDescription = patch.description ?? row.description;
    if (wantsDateChange) {
      resolvedNext = resolveTargetDates({
        target_dates: patch.target_dates,
        target_date: patch.target_date,
      });
      if (!resolvedNext) return { ok: false, error: "Pick at least one day." };
    } else {
      const currentDates =
        row.target_dates && row.target_dates.length > 0
          ? row.target_dates
          : [row.target_date];
      resolvedNext = {
        dates: currentDates,
        deadline: currentDates[currentDates.length - 1],
      };
    }
    const gate = validateMissionConcreteness({
      description: nextDescription,
      target_date: resolvedNext.deadline,
    });
    if (!gate.ok) return { ok: false, error: gate.reason };
  }

  const supabase = await createSupabaseServerClient();
  const update: Record<string, unknown> = {};
  if (patch.description !== undefined) update.description = patch.description.trim();
  if (wantsDateChange && resolvedNext) {
    update.target_date = resolvedNext.deadline;
    update.target_dates = resolvedNext.dates;
  }
  if (patch.quality_score !== undefined) update.quality_score = patch.quality_score;

  const { error } = await supabase
    .from("missions")
    .update(update)
    .eq("id", mission_id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/missions");
  revalidatePath("/today");
  return { ok: true };
}

const DeleteSchema = z.object({ mission_id: z.string().uuid() });

export async function deleteMission(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("missions")
    .delete()
    .eq("id", parsed.data.mission_id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/missions");
  revalidatePath("/today");
  return { ok: true };
}

export async function completeMission(
  missionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };

  const supabase = await createSupabaseServerClient();
  const { data: m, error: fetchErr } = await supabase
    .from("missions")
    .select("target_date, description, quality_score, is_exemplar")
    .eq("id", missionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (fetchErr || !m) return { ok: false, error: "Not found." };

  const row = m as {
    target_date: string;
    description: string;
    quality_score: number | null;
    is_exemplar: boolean;
  };
  const today = new Date().toISOString().slice(0, 10);
  const late = today > row.target_date;

  const { error } = await supabase
    .from("missions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_late: late,
    })
    .eq("id", missionId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  // Fetch pillar for the analytics event. Small extra roundtrip is
  // fine — this action is user-triggered, not hot-path.
  const { data: pill } = await supabase
    .from("missions")
    .select("pillar_code")
    .eq("id", missionId)
    .maybeSingle();
  const pillar = (pill as { pillar_code: string } | null)?.pillar_code ?? "unknown";
  captureServerEvent(user.id, {
    name: "mission_completed",
    props: { pillar_code: pillar, completed_late: late },
  });

  // Deterministic auto-exemplar: quality_score >= 9 AND on-time completion.
  // (Score 9+ mathematically requires no zero-scored criterion.)
  if (!row.is_exemplar && !late && (row.quality_score ?? 0) >= 9) {
    // Fire-and-forget: anonymize and promote in the background so the click
    // stays snappy. Any failure just leaves is_exemplar=false.
    void promoteToExemplar(missionId, row.description);
  }

  revalidatePath("/missions");
  return { ok: true };
}

async function promoteToExemplar(missionId: string, description: string) {
  try {
    const { anonymizeMissionText } = await import("@/lib/coach/anonymize");
    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const anonymized = await anonymizeMissionText(description);
    const svc = createSupabaseServiceClient();
    await svc
      .from("missions")
      .update({
        is_exemplar: true,
        exemplar_text: anonymized,
        exemplar_last_review_at: new Date().toISOString(),
      })
      .eq("id", missionId);
  } catch (err) {
    console.error("promote to exemplar failed", err);
  }
}

const CarryForwardSchema = z.object({ mission_id: z.string().uuid() });

/**
 * Duplicate a mission +7 days out — same description, same pillar, same
 * goal link, same day(s)-of-week. Source row is left intact — this
 * replaced the older rolloverMission (retired 2026-09-01), which
 * flipped the source status to "rolled_over" and only fit the
 * incomplete-mission-forward flow. Works on completed and active
 * missions — the two moments a coachee reaches for this are "this
 * is my weekly staple" and "I want another crack next week".
 *
 * Returns the new target dates so the caller can echo a confirmation.
 */
export async function carryMissionToNextWeek(
  input: unknown,
): Promise<
  | { ok: true; new_target_dates: string[]; new_deadline: string }
  | { ok: false; error: string }
> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = CarryForwardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };

  const supabase = await createSupabaseServerClient();
  const { data: prev, error: fetchErr } = await supabase
    .from("missions")
    .select(
      "id, description, pillar_code, community_id, quarterly_goal_id, target_date, target_dates",
    )
    .eq("id", parsed.data.mission_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (fetchErr || !prev) return { ok: false, error: "Not found." };
  const p = prev as {
    id: string;
    description: string;
    pillar_code: string;
    community_id: string;
    quarterly_goal_id: string | null;
    target_date: string;
    target_dates: string[] | null;
  };

  const sourceDates =
    p.target_dates && p.target_dates.length > 0 ? p.target_dates : [p.target_date];
  const nextDates = shiftDatesByOneWeek(sourceDates).sort();
  const deadline = nextDates[nextDates.length - 1];

  const { error: insErr } = await supabase.from("missions").insert({
    user_id: user.id,
    community_id: p.community_id,
    pillar_code: p.pillar_code,
    description: p.description,
    target_date: deadline,
    target_dates: nextDates,
    quarterly_goal_id: p.quarterly_goal_id,
    created_by: "user",
    rolled_over_from_mission_id: p.id,
  });
  if (insErr) return { ok: false, error: insErr.message };
  revalidatePath("/missions");
  revalidatePath("/today");
  return { ok: true, new_target_dates: nextDates, new_deadline: deadline };
}

