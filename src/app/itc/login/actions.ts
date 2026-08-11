"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { itcDemoAuthEnabled, setItcSessionCookie } from "@/lib/itc/session";

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

  if (parsed.data.password !== DEMO_PASSWORD) {
    redirect("/itc/login?error=bad_password");
  }

  const participant = await upsertParticipantByEmail(parsed.data.email);
  await setItcSessionCookie(participant.id);
  redirect("/itc");
}
