"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Schema = z.object({
  partner_name: z.string().max(120).optional().nullable(),
  relationship_label: z
    .enum(["wife", "husband", "partner", "girlfriend", "boyfriend", "fiancee"])
    .optional()
    .nullable(),
  partner_birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  relationship_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  loved_1: z.string().max(280).optional().nullable(),
  loved_2: z.string().max(280).optional().nullable(),
  loved_3: z.string().max(280).optional().nullable(),
});

function toStringOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function savePartnerFromMe(formData: FormData) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/me");
  const parsed = Schema.safeParse({
    partner_name: toStringOrNull(formData.get("partner_name")),
    relationship_label: toStringOrNull(formData.get("relationship_label")),
    partner_birthdate: toStringOrNull(formData.get("partner_birthdate")),
    relationship_date: toStringOrNull(formData.get("relationship_date")),
    loved_1: toStringOrNull(formData.get("loved_1")),
    loved_2: toStringOrNull(formData.get("loved_2")),
    loved_3: toStringOrNull(formData.get("loved_3")),
  });
  if (!parsed.success) redirect("/me/partner?error=Bad+input");

  const supabase = await createSupabaseServerClient();
  const things_loved = [parsed.data.loved_1, parsed.data.loved_2, parsed.data.loved_3]
    .filter((x): x is string => !!x);

  await supabase.from("partner_profiles").upsert(
    {
      user_id: user.id,
      partner_name: parsed.data.partner_name,
      relationship_label: parsed.data.relationship_label,
      partner_birthdate: parsed.data.partner_birthdate,
      relationship_date: parsed.data.relationship_date,
      things_loved,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  redirect("/me");
}
