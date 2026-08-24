"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUserHasItcAccess, requireUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
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
  redirect("/onboarding/profile");
}

const ProfileSchema = z.object({
  city: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  avatar_data_url: z.string().max(2_500_000).optional(),
});

/**
 * Save profile step: avatar (from a data URL produced by the client-
 * side cropper), city, and phone. All three are optional-friendly —
 * users can skip any/all and move on.
 *
 * Avatar upload path: the client-side cropper renders the final image
 * to a canvas and posts it as a base64 data URL (already square,
 * already the target size). We decode + upload to Supabase Storage
 * at avatars/{user_id}/profile.jpg using the service client (RLS
 * would also let the browser upload directly but going through the
 * server keeps the flow inside the existing form-action pattern
 * and centralizes the cache-buster logic).
 */
export async function saveProfile(formData: FormData) {
  const user = await requireUser();
  const parsed = ProfileSchema.safeParse({
    city: (formData.get("city") ?? undefined) as string | undefined,
    phone: (formData.get("phone") ?? undefined) as string | undefined,
    avatar_data_url: (formData.get("avatar_data_url") ?? undefined) as
      | string
      | undefined,
  });
  if (!parsed.success) {
    redirect("/onboarding/profile?error=Something+about+your+input+isn%27t+valid.");
  }

  const updates: Record<string, unknown> = {
    city: parsed.data.city?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
  };

  // Upload avatar if the cropper produced one. Data URL shape:
  //   data:image/jpeg;base64,<payload>
  const dataUrl = parsed.data.avatar_data_url?.trim();
  if (dataUrl && dataUrl.startsWith("data:image/")) {
    const commaIdx = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, commaIdx); // "image/jpeg;base64"
    const [mime] = meta.split(";");
    const base64 = dataUrl.slice(commaIdx + 1);
    const bytes = Buffer.from(base64, "base64");
    const svc = createSupabaseServiceClient();
    const ext = mime === "image/png" ? "png" : "jpg";
    const path = `${user.id}/profile.${ext}`;
    const { error: uploadErr } = await svc.storage
      .from("avatars")
      .upload(path, bytes, {
        contentType: mime,
        upsert: true,
        cacheControl: "3600",
      });
    if (uploadErr) {
      console.warn("[onboarding] avatar upload failed: %s", uploadErr.message);
      redirect(
        "/onboarding/profile?error=" +
          encodeURIComponent(`Avatar upload failed: ${uploadErr.message}`),
      );
    }
    const {
      data: { publicUrl },
    } = svc.storage.from("avatars").getPublicUrl(path);
    // Append cache-buster so browsers pick up the new avatar even
    // though the URL path itself is stable.
    updates.avatar_url = `${publicUrl}?v=${Date.now()}`;
  }

  const supabase = await createSupabaseServerClient();
  await supabase.from("users").update(updates).eq("id", user.id);
  await bumpStep(2);
  redirect("/onboarding/why");
}

export async function skipProfile() {
  await bumpStep(2);
  redirect("/onboarding/why");
}

export async function saveWhy(formData: FormData) {
  const user = await requireUser();
  const why = String(formData.get("why") ?? "").trim();
  if (why.length < 8) redirect("/onboarding/why?error=Give+it+a+real+answer.");
  const supabase = await createSupabaseServerClient();
  await supabase.from("users").update({ why_yes: why }).eq("id", user.id);
  await bumpStep(3);
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
  await bumpStep(4);
  redirect("/onboarding/kids");
}

export async function skipPartner() {
  await bumpStep(4);
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
  // Goal + mission steps are temporarily hidden — jump straight from
  // kids to first-checkin. The pages exist and can be reintroduced
  // by restoring them to onboardingRouteFor + bumping the step count
  // in session.ts.
  await bumpStep(5);
  redirect("/onboarding/first-checkin");
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
  const { getCurrentQuarter, computeMidpointCheckAt } = await import(
    "@/lib/scoring/quarters"
  );
  const q = getCurrentQuarter();
  const midpointCheckAt = computeMidpointCheckAt(q.endIso, new Date());
  // Onboarding stays lean (one input field) to keep the funnel short.
  // The single input maps to desired_end_state; the coachee can add
  // current_state from /goals when they land there post-onboarding.
  await supabase.from("quarterly_goals").insert({
    user_id: user.id,
    focus_area: parsed.data.focus_area,
    desired_end_state: parsed.data.description.trim(),
    quarter_start: q.startIso,
    source: "user",
    midpoint_check_at: midpointCheckAt,
  });
  await bumpStep(6);
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
  await bumpStep(7);
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
  await bumpStep(6);
  // ITC users land back on /itc after finishing the wizard (that's
  // the surface they came in for). Everyone else goes to /today.
  const hasItc = await currentUserHasItcAccess();
  redirect(hasItc ? "/itc" : "/today");
}
