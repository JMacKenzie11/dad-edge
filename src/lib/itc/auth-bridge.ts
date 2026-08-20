import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Bridge an itc_participants row to a public.users row (creating the
 * auth.users record + comped users row if needed). Called lazily on
 * the first ITC action that writes into a tracker-owned table
 * (quarterly_goals, missions). Idempotent: subsequent calls short-
 * circuit on the stored user_id.
 *
 * Three paths:
 *   1. participant.user_id already set — return it.
 *   2. A public.users row exists with the participant's email — link
 *      (participants.user_id = users.id) and return.
 *   3. No existing user — create an auth.users row via the admin API
 *      (triggers handle_new_auth_user which inserts a users row), then
 *      patch the users row to comped + onboarding_step=7 so ITC-only
 *      coachees who later touch the main app don't land in a stuck
 *      onboarding state or a broken subscription gate. Link + return.
 *
 * Why not build magic-link auth for ITC coachees now? Because the
 * current demo login (email + "1111") is fine for the Boardroom
 * pilot; the auth bridge only needs to exist so the ITC map can
 * write to the tracker. Full auth migration is §17 in PRODUCT_SPEC.
 */
export async function ensureUserForItcParticipant(
  participantId: string,
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const supabase = createSupabaseServiceClient();

  const { data: participant, error: fetchErr } = await supabase
    .from("itc_participants")
    .select("id, email, user_id")
    .eq("id", participantId)
    .maybeSingle();
  if (fetchErr || !participant) {
    return {
      ok: false,
      reason: `Participant lookup failed: ${fetchErr?.message ?? "not found"}`,
    };
  }
  if (participant.user_id) {
    return { ok: true, userId: participant.user_id as string };
  }

  const normalizedEmail = (participant.email as string).trim().toLowerCase();

  // Path 2: existing user with this email — link and return.
  const { data: existingUser, error: existingErr } = await supabase
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existingErr) {
    return {
      ok: false,
      reason: `User lookup failed: ${existingErr.message}`,
    };
  }
  if (existingUser?.id) {
    const { error: linkErr } = await supabase
      .from("itc_participants")
      .update({ user_id: existingUser.id })
      .eq("id", participantId);
    if (linkErr) {
      return {
        ok: false,
        reason: `Could not link participant to existing user: ${linkErr.message}`,
      };
    }
    return { ok: true, userId: existingUser.id as string };
  }

  // Path 3: create auth.users → users trigger fires → then patch to
  // comped + onboarding_step=7.
  const { data: authCreate, error: authErr } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true, // ITC-only coachee; can claim via magic link later
  });
  if (authErr || !authCreate?.user?.id) {
    return {
      ok: false,
      reason: `Auth user create failed: ${authErr?.message ?? "no id"}`,
    };
  }
  const newUserId = authCreate.user.id;

  // The handle_new_auth_user trigger inserted a users row with
  // subscription_status='trialing' and onboarding_step=0. Patch to
  // 'comped' + onboarding_step=7 so ITC-only users pass the
  // entitlement gate and don't get bounced into onboarding if they
  // ever land on /today.
  const { error: patchErr } = await supabase
    .from("users")
    .update({ subscription_status: "comped", onboarding_step: 7 })
    .eq("id", newUserId);
  if (patchErr) {
    // Non-fatal — the row exists; log and continue. ITC will still
    // work; the user just has trialing status which will grant
    // access via the entitlement gate anyway.
    console.warn(
      "[itc auth-bridge] patch to comped failed for user %s: %s",
      newUserId,
      patchErr.message,
    );
  }

  const { error: linkErr } = await supabase
    .from("itc_participants")
    .update({ user_id: newUserId })
    .eq("id", participantId);
  if (linkErr) {
    return {
      ok: false,
      reason: `Could not link participant to new user: ${linkErr.message}`,
    };
  }

  return { ok: true, userId: newUserId };
}
