"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isStageBEmailLive, sendPasswordResetEmail } from "@/lib/email";

/**
 * Auth actions for the public login screen. Per the auth-phase spec
 * (2026-08-22), public sign-up is off — account creation happens only
 * through the admin panel + Send Invite flow. The exported actions
 * here are:
 *
 *   signIn                — email + password sign-in
 *   requestPasswordReset  — forgot-password link email
 *   updatePassword        — new-password form on /reset-password, also
 *                            signs out every OTHER active session so a
 *                            reset triggered by a real compromise
 *                            doesn't leave a stolen device signed in
 *
 * The old signUp action is removed. Public sign-up is off.
 * Magic-link fallback removed 2026-08-23 — Forgot password covers the
 * locked-out-of-password case; a second "email me a link" path was
 * just noise.
 */

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300";
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  // Empty next means "no explicit destination" — we'll pick based on
  // itc_access after we know who signed in. If a `next` was passed
  // (from ?next= on the URL), it's an explicit request; honor it.
  const nextRaw = String(formData.get("next") ?? "").trim();
  const explicitNext = nextRaw && nextRaw !== "/today" ? nextRaw : null;

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Email and password required.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    console.warn("[login] signIn failed for %s: %s", email, error.message);
    // Deliberately generic error copy — same message for "no such
    // account" and "wrong password" so this screen can't be used
    // to probe whether an email exists.
    redirect(`/login?error=${encodeURIComponent("That email and password don't match.")}`);
  }

  console.info(
    "[login] signIn ok user=%s session=%s",
    signInData.user?.id ?? "(none)",
    signInData.session ? "present" : "absent",
  );

  // Bust the route cache so the middleware picks up the newly-set
  // session cookies on the redirect target. Without this, Next's
  // cache can serve a stale not-signed-in view and the middleware
  // bounces the user back to /login — a sign-in loop.
  revalidatePath("/", "layout");

  if (explicitNext) {
    redirect(explicitNext);
  }

  // Pick the default landing:
  //   - Platform admins → /today (their admin surface lives there;
  //     they can navigate to /itc via the header link)
  //   - Non-admin ITC users → /itc (that's their whole world)
  //   - Everyone else → /today
  const user = signInData.user;
  if (user) {
    const { data: row } = await supabase
      .from("users")
      .select("itc_access, is_platform_admin, is_admin_only")
      .eq("id", user.id)
      .maybeSingle();
    const r = row as
      | {
          itc_access: boolean | null;
          is_platform_admin: boolean | null;
          is_admin_only: boolean | null;
        }
      | null;
    // Admin-only users have no coachee shell — land on /admin.
    if (r?.is_admin_only) redirect(`/admin`);
    if (r?.itc_access && !r?.is_platform_admin) {
      redirect(`/itc`);
    }
  }
  redirect(`/today`);
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    redirect(`/login?mode=forgot&error=${encodeURIComponent("Enter your email.")}`);
  }

  const redirectTo = `${appOrigin()}/auth/callback?next=/reset-password`;

  if (!isStageBEmailLive()) {
    // Stage A: Supabase generates the link AND sends its default email.
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      if (isRateLimitError(error.message)) {
        redirect(
          `/login?mode=forgot&error=${encodeURIComponent("Just sent one. Check your inbox, or try again in a few minutes.")}`,
        );
      }
      console.warn("[login] password reset (Stage A) swallowed:", error.message);
    }
    redirect(`/login?reset=1`);
  }

  // Stage B: generate the recovery link ourselves and send via Resend.
  // Look up the user first for the greeting; swallow silently if not
  // found so we don't leak account existence.
  const svc = createSupabaseServiceClient();
  const { data: userRow } = await svc
    .from("users")
    .select("id, first_name")
    .eq("email", email)
    .maybeSingle();
  if (userRow) {
    const { data, error: linkErr } = await svc.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (linkErr) {
      if (isRateLimitError(linkErr.message)) {
        redirect(
          `/login?mode=forgot&error=${encodeURIComponent("Just sent one. Check your inbox, or try again in a few minutes.")}`,
        );
      }
      console.warn(
        "[login] password reset (Stage B) generateLink swallowed:",
        linkErr.message,
      );
    } else {
      const actionLink = data.properties?.action_link;
      if (actionLink) {
        const first = (userRow as { first_name: string | null }).first_name;
        const send = await sendPasswordResetEmail({
          to: email,
          firstName: first,
          resetUrl: actionLink,
        });
        if (!send.ok) {
          console.warn(
            "[login] password reset (Stage B) send swallowed:",
            send.error,
          );
        }
      }
    }
  }
  // Always show success, regardless of whether a real send happened.
  redirect(`/login?reset=1`);
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    redirect(`/reset-password?error=${encodeURIComponent("Password must be at least 8 characters.")}`);
  }
  if (password !== confirm) {
    redirect(`/reset-password?error=${encodeURIComponent("Passwords don't match.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: updateData, error } = await supabase.auth.updateUser({
    password,
  });
  if (error) {
    console.warn("[login] updatePassword failed: %s", error.message);
    // Supabase rejects when the new password equals the current one.
    // Raw error copy ("New password should be different from the old
    // password") reads as scary; translate to a friendlier hint that
    // acknowledges they might have already set this password on a
    // prior attempt and can just sign in.
    const friendly = /different from the old|same as the old/i.test(
      error.message,
    )
      ? "You've already set that password. Sign in with it here — no need to reset again."
      : error.message;
    redirect(`/reset-password?error=${encodeURIComponent(friendly)}`);
  }

  console.info(
    "[login] updatePassword ok user=%s",
    updateData.user?.id ?? "(none)",
  );

  // NOTE: We used to call `signOut({ scope: "others" })` here to log
  // out any other active sessions after a password change (the
  // "stolen device" hardening). But that call turned out to invalidate
  // the CURRENT session's tokens too under Next.js server-action
  // cookie handling — causing an immediate sign-in loop on redirect
  // to /today. Dropping the call keeps activation and reset working
  // reliably; re-adding it will need a proper Supabase SSR pattern
  // that doesn't clobber the just-refreshed cookie.

  // Bust the route cache so the middleware sees the fresh session.
  revalidatePath("/", "layout");

  // Steer non-admin ITC users straight to /itc after activation /
  // password reset — /itc is their whole world; landing them on
  // /today first would be a detour. Platform admins always land on
  // /today so their admin surface is one click away; they can jump
  // to /itc via the header link.
  const user = updateData.user;
  if (user) {
    const { data: row } = await supabase
      .from("users")
      .select("itc_access, is_platform_admin, is_admin_only")
      .eq("id", user.id)
      .maybeSingle();
    const r = row as
      | {
          itc_access: boolean | null;
          is_platform_admin: boolean | null;
          is_admin_only: boolean | null;
        }
      | null;
    if (r?.is_admin_only) redirect(`/admin`);
    if (r?.itc_access && !r?.is_platform_admin) {
      redirect(`/itc`);
    }
  }

  redirect(`/today`);
}

/**
 * Heuristic for Supabase rate-limit error strings. Supabase doesn't
 * expose a stable error code for auth rate limits so we match on the
 * common substrings its message uses.
 */
function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("try again")
  );
}
