import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isStageBEmailLive, sendActivationEmail } from "@/lib/email";

/**
 * The activation invite, shared by the admin Send Invite buttons and the
 * Stripe webhook (src/lib/billing/webhook.ts). Moved here from
 * src/app/(admin)/admin/users/actions.ts unchanged, except that Stage A
 * no longer needs a browser session.
 */

export function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300";
}

/**
 * Deliver an activation email to a user, using the right sender for
 * the current stage.
 *
 * Uses Supabase's RECOVERY link, not INVITE. Rationale: createAccount
 * has already created the auth.users row (email_confirm=true, no
 * password), so the user *already exists*. Supabase's invite type
 * (inviteUserByEmail / generateLink type=invite) refuses existing
 * users with "A user with this email address has already been
 * registered". Recovery works whether the user has a password or
 * not, drops them into a session, and — with redirectTo pointing at
 * /set-password — lands them on the same activation flow.
 *
 * Stage A (default, EMAIL_STAGE unset or !== "B"): call
 * supabase.auth.resetPasswordForEmail — Supabase generates the link
 * AND sends its own default template. Ugly, unbranded, but unblocks
 * testing without any DNS work. Safe for internal use; MUST NOT be
 * used to invite a real person.
 *
 * Stage B (EMAIL_STAGE=B + RESEND_API_KEY set): generate the recovery
 * link via svc.auth.admin.generateLink({type: 'recovery'}) but skip
 * Supabase's sender; deliver our own branded email via Resend using
 * the activation copy in src/lib/copy/auth-emails.ts. Copy still
 * reads as "activation" — from the user's POV this is their first
 * password-set, even though under the hood it's a recovery flow.
 *
 * Returns a string error message on failure, null on success.
 */
export async function deliverActivationInvite(user: {
  id: string;
  email: string;
  first_name: string | null;
}, opts: { communityName?: string | null } = {}): Promise<string | null> {
  const svc = createSupabaseServiceClient();
  const redirectTo = `${appOrigin()}/auth/callback?next=/set-password`;

  if (!isStageBEmailLive()) {
    // Stage A: let Supabase send its default reset email.
    // A plain anon client, not the cookie-bound server one, so this also
    // works from the Stripe webhook, which has no browser session.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo,
    });
    return error?.message ?? null;
  }

  // Stage B: generate the link without sending Supabase's default,
  // then deliver our own branded email via Resend.
  const { data, error: linkErr } = await svc.auth.admin.generateLink({
    type: "recovery",
    email: user.email,
    options: { redirectTo },
  });
  if (linkErr) return linkErr.message;
  const actionLink = data.properties?.action_link;
  if (!actionLink) return "generateLink returned no action_link";

  // Look up the user's community for the greeting.
  const { data: membership } = await svc
    .from("memberships")
    .select("communities:community_id(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const memRaw = membership as
    | { communities: { name: string } | { name: string }[] | null }
    | null;
  const communityName = memRaw?.communities
    ? Array.isArray(memRaw.communities)
      ? (memRaw.communities[0]?.name ?? null)
      : (memRaw.communities.name ?? null)
    : null;

  const result = await sendActivationEmail({
    to: user.email,
    firstName: user.first_name,
    communityName: opts.communityName ?? communityName,
    activationUrl: actionLink,
  });
  return result.ok ? null : result.error;
}
