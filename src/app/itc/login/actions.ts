"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { itcDemoAuthEnabled, setItcSessionCookie } from "@/lib/itc/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const DEMO_PASSWORD = "1111";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(64),
});

export async function itcLogin(formData: FormData): Promise<void> {
  if (!itcDemoAuthEnabled()) {
    redirect("/itc/login?error=disabled");
  }

  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect("/itc/login?error=invalid");
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Transition messaging per auth-phase spec Section 8. If this email
  // has already been migrated to the main-app users table AND granted
  // ITC access, don't let them into a stale demo session — point them
  // at the main-app login where their real account lives.
  //
  // Detection: users row exists for the email AND itc_access is true.
  // (itc_access alone is enough — every migrated ITC participant gets
  // that flag set by migration 20260822000001's backfill.)
  const svc = createSupabaseServiceClient();
  const { data: userRow } = await svc
    .from("users")
    .select("id, itc_access")
    .eq("email", email)
    .maybeSingle();
  const row = userRow as { id: string; itc_access: boolean } | null;
  if (row?.itc_access) {
    redirect("/itc/login?error=migrated");
  }

  if (parsed.data.password !== DEMO_PASSWORD) {
    redirect("/itc/login?error=bad_password");
  }

  const participant = await upsertParticipantByEmail(email);
  await setItcSessionCookie(participant.id);
  redirect("/itc");
}
