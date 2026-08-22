"use server";

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
 *   requestMagicLink      — "email me a sign-in link instead" fallback
 *                            for a man locked out of his password
 *   requestPasswordReset  — forgot-password link email
 *   updatePassword        — new-password form on /reset-password, also
 *                            signs out every OTHER active session so a
 *                            reset triggered by a real compromise
 *                            doesn't leave a stolen device signed in
 *
 * The old signUp action is removed. Public sign-up is off.
 */

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300";
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/today");

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Email and password required.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Deliberately generic error copy — same message for "no such
    // account" and "wrong password" so this screen can't be used
    // to probe whether an email exists.
    redirect(`/login?error=${encodeURIComponent("That email and password don't match.")}`);
  }
  redirect(next);
}

/**
 * Magic-link fallback. A man who's locked out of his password and
 * doesn't want the reset dance can request a one-shot sign-in link.
 * Kept per product decision 2026-08-22 as a small friction-reducing
 * addition; easy to remove later if we want a single clean path.
 *
 * Same "never reveal existence" rule as password reset — always show
 * success regardless of whether the email matched an account.
 */
export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = String(formData.get("next") ?? "/today");
  if (!email) {
    redirect(`/login?error=${encodeURIComponent("Enter your email.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // shouldCreateUser=false: magic link only works for existing
      // accounts. Never auto-creates. New accounts go through admin
      // Send Invite (Checkpoint C).
      shouldCreateUser: false,
      emailRedirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    if (isRateLimitError(error.message)) {
      redirect(
        `/login?error=${encodeURIComponent("Just sent one. Check your inbox, or try again in a few minutes.")}`,
      );
    }
    // Swallow any other error so we don't leak account existence.
    console.warn("[login] magic link swallowed:", error.message);
  }
  redirect(`/login?sent=magic`);
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
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message)}`);
  }

  // Invalidate every OTHER active session for this user, so a reset
  // triggered by a real compromise doesn't leave a stolen device
  // still signed in. The current session (the one that just set the
  // new password) stays alive.
  await supabase.auth.signOut({ scope: "others" });

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
