"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateMissionConcreteness } from "@/lib/validation/mission";

const PillarCodeSchema = z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]);
const RelationshipLabel = z.enum(["wife", "husband", "partner", "girlfriend", "boyfriend", "fiancee"]);

async function bumpStep(next: number) {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("users")
    .update({ onboarding_step: next })
    .eq("id", user.id)
    .lt("onboarding_step", next);
}

const EmploymentTypeSchema = z.enum([
  "w2",
  "contract",
  "self_employed",
  "business_owner",
  "other",
]);

const IdentitySchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(0).max(80),
  timezone: z.string().min(3).max(80),
  occupation: z.string().max(120).optional(),
  employment_type: EmploymentTypeSchema.optional(),
});

export async function saveIdentity(formData: FormData) {
  const user = await requireUser();
  const parsed = IdentitySchema.safeParse({
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name") ?? "",
    timezone: formData.get("timezone"),
    occupation: (formData.get("occupation") as string) || undefined,
    employment_type: (formData.get("employment_type") as string) || undefined,
  });
  if (!parsed.success) redirect("/onboarding?error=Fill+your+name+and+timezone.");
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("users")
    .update({
      first_name: parsed.data.first_name.trim(),
      last_name: parsed.data.last_name.trim() || null,
      timezone: parsed.data.timezone,
      occupation: parsed.data.occupation?.trim() || null,
      employment_type: parsed.data.employment_type ?? null,
    })
    .eq("id", user.id);
  await bumpStep(1);
  redirect("/onboarding/why");
}

export async function saveWhy(formData: FormData) {
  const user = await requireUser();
  const why = String(formData.get("why") ?? "").trim();
  if (why.length < 8) redirect("/onboarding/why?error=Give+it+a+real+answer.");
  const supabase = await createSupabaseServerClient();
  await supabase.from("users").update({ why_yes: why }).eq("id", user.id);
  await bumpStep(2);
  redirect("/onboarding/partner");
}

const PartnerSchema = z.object({
  partner_name: z.string().max(120).optional(),
  relationship_label: RelationshipLabel.optional(),
  partner_birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  relationship_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  loved_1: z.string().max(280).optional(),
  loved_2: z.string().max(280).optional(),
  loved_3: z.string().max(280).optional(),
});

export async function savePartner(formData: FormData) {
  const user = await requireUser();
  const parsed = PartnerSchema.safeParse({
    partner_name: (formData.get("partner_name") ?? undefined) as string | undefined,
    relationship_label: (formData.get("relationship_label") ?? undefined) as string | undefined,
    partner_birthdate: (formData.get("partner_birthdate") ?? undefined) as string | undefined,
    relationship_date: (formData.get("relationship_date") ?? undefined) as string | undefined,
    loved_1: (formData.get("loved_1") ?? undefined) as string | undefined,
    loved_2: (formData.get("loved_2") ?? undefined) as string | undefined,
    loved_3: (formData.get("loved_3") ?? undefined) as string | undefined,
  });
  const supabase = await createSupabaseServerClient();

  if (parsed.success && parsed.data.partner_name) {
    const things_loved = [parsed.data.loved_1, parsed.data.loved_2, parsed.data.loved_3]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .map((s) => s.trim());
    await supabase.from("partner_profiles").upsert(
      {
        user_id: user.id,
        partner_name: parsed.data.partner_name.trim(),
        relationship_label: parsed.data.relationship_label ?? null,
        partner_birthdate: parsed.data.partner_birthdate ?? null,
        relationship_date: parsed.data.relationship_date ?? null,
        things_loved,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  }
  await bumpStep(3);
  redirect("/onboarding/kids");
}

export async function skipPartner() {
  await bumpStep(3);
  redirect("/onboarding/kids");
}

const KidSchema = z.object({
  name: z.string().min(1).max(120),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  loved: z.string().max(280).optional(),
});

export async function addKid(formData: FormData) {
  const user = await requireUser();
  const parsed = KidSchema.safeParse({
    name: formData.get("name"),
    birthdate: (formData.get("birthdate") ?? "") as string,
    loved: (formData.get("loved") ?? "") as string,
  });
  if (!parsed.success) redirect("/onboarding/kids?error=Add+a+name.");
  const supabase = await createSupabaseServerClient();
  const things_loved = parsed.data.loved?.trim() ? [parsed.data.loved.trim()] : [];
  await supabase.from("children").insert({
    user_id: user.id,
    name: parsed.data.name.trim(),
    birthdate: parsed.data.birthdate ? parsed.data.birthdate : null,
    things_loved,
  });
  redirect("/onboarding/kids");
}

export async function finishKids() {
  await bumpStep(4);
  redirect("/onboarding/goal");
}

const GoalSchema = z.object({
  focus_area: PillarCodeSchema,
  description: z.string().min(4).max(280),
});

export async function saveFirstGoal(formData: FormData) {
  const user = await requireUser();
  const parsed = GoalSchema.safeParse({
    focus_area: formData.get("focus_area"),
    description: formData.get("description"),
  });
  if (!parsed.success) redirect("/onboarding/goal?error=Pick+pillar+and+write+the+goal.");
  const supabase = await createSupabaseServerClient();
  const y = new Date().getFullYear();
  const q = Math.floor(new Date().getMonth() / 3);
  const quarter_start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  await supabase.from("quarterly_goals").insert({
    user_id: user.id,
    focus_area: parsed.data.focus_area,
    description: parsed.data.description.trim(),
    quarter_start,
  });
  await bumpStep(5);
  redirect("/onboarding/mission");
}

const MissionSchema = z.object({
  community_id: z.string().uuid(),
  pillar_code: PillarCodeSchema,
  description: z.string().min(1).max(280),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function saveFirstMission(formData: FormData) {
  const user = await requireUser();
  const parsed = MissionSchema.safeParse({
    community_id: formData.get("community_id"),
    pillar_code: formData.get("pillar_code"),
    description: formData.get("description"),
    target_date: formData.get("target_date"),
  });
  if (!parsed.success) redirect("/onboarding/mission?error=Behavior+plus+day.");

  const gate = validateMissionConcreteness({
    description: parsed.data.description,
    target_date: parsed.data.target_date,
  });
  if (!gate.ok) {
    redirect(`/onboarding/mission?error=${encodeURIComponent(gate.reason)}`);
  }

  const supabase = await createSupabaseServerClient();
  await supabase.from("missions").insert({
    user_id: user.id,
    community_id: parsed.data.community_id,
    pillar_code: parsed.data.pillar_code,
    description: parsed.data.description.trim(),
    target_date: parsed.data.target_date,
    created_by: "user",
  });
  await bumpStep(6);
  redirect("/onboarding/first-checkin");
}

const CheckinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  values: z.string(), // JSON payload
});

export async function saveFirstCheckin(formData: FormData) {
  const user = await requireUser();
  const parsed = CheckinSchema.safeParse({
    date: formData.get("date"),
    values: formData.get("values"),
  });
  if (!parsed.success) redirect("/onboarding/first-checkin?error=Log+at+least+one+pillar.");

  const values = JSON.parse(parsed.data.values) as Record<string, 0 | 1 | null>;
  const rows = Object.entries(values)
    .filter(([, v]) => v === 0 || v === 1)
    .map(([code, value]) => ({
      user_id: user.id,
      date: parsed.data.date,
      pillar_code: code,
      value: value as 0 | 1,
    }));
  if (rows.length === 0) redirect("/onboarding/first-checkin?error=Log+at+least+one+pillar.");

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("daily_checkins")
    .upsert(rows, { onConflict: "user_id,date,pillar_code" });
  await bumpStep(7);
  redirect("/today");
}
