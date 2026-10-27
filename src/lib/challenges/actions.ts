"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { friendlyChallengeError } from "./rules";

/**
 * A member's own answers to a challenge. All three run as him: the
 * database functions and row-level security decide what's allowed
 * (supabase/migrations/20261027000001_challenges.sql).
 */

type Result = { ok: true } | { ok: false; error: string };

const Id = z.string().uuid();

function refresh() {
  revalidatePath("/today");
  revalidatePath("/missions");
  revalidatePath("/community");
}

export async function joinChallenge(challengeId: string): Promise<Result> {
  const { readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  if (!Id.safeParse(challengeId).success) return { ok: false, error: "That challenge isn't open to you." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("join_challenge", { p_challenge: challengeId });
  if (error) return { ok: false, error: friendlyChallengeError(error, "Joining didn't work. Try again.") };
  refresh();
  return { ok: true };
}

/** "Not for me": hides the card. He can still join from the Challenges tab. */
export async function declineChallenge(challengeId: string): Promise<Result> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  if (!Id.safeParse(challengeId).success) return { ok: false, error: "That challenge isn't open to you." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("challenge_participants")
    .upsert(
      { challenge_id: challengeId, user_id: user.id, status: "declined" },
      { onConflict: "challenge_id,user_id", ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: "That didn't save. Try again." };
  refresh();
  return { ok: true };
}

/**
 * Opting out. From today on his challenge missions are removed, or kept
 * as regular missions if he asks to keep them.
 */
export async function leaveChallenge(challengeId: string, keepMissions: boolean): Promise<Result> {
  const { readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  if (!Id.safeParse(challengeId).success) return { ok: false, error: "That challenge isn't open to you." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("leave_challenge", { p_challenge: challengeId, p_keep_missions: keepMissions === true });
  if (error) return { ok: false, error: friendlyChallengeError(error, "Leaving didn't work. Try again.") };
  refresh();
  return { ok: true };
}
