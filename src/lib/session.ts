import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccess, type SubscriptionStatus } from "@/lib/entitlement";

export type EmploymentType =
  | "w2"
  | "contract"
  | "self_employed"
  | "business_owner"
  | "other";

export type SessionUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  timezone: string;
  is_platform_admin: boolean;
  /** True → user is backstage-only. Skips onboarding, has no
   *  community, coachee shell is not rendered. See migration
   *  20260825000003_users_admin_only.sql. Requires is_platform_admin. */
  is_admin_only: boolean;
  subscription_status: SubscriptionStatus;
  deactivated_at: string | null;
  onboarding_step: number;
  occupation: string | null;
  employment_type: EmploymentType | null;
  avatar_url: string | null;
  city: string | null;
  phone: string | null;
};

/**
 * Load the current user + app row. Redirects to /login if unauthenticated.
 * Every protected page starts with this call.
 */
export async function requireUser(): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, timezone, is_platform_admin, is_admin_only, itc_access, subscription_status, canceled_at, onboarding_step, occupation, employment_type, avatar_url, city, phone")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) redirect("/login");
  const row = data as {
    canceled_at: string | null;
    onboarding_step: number | null;
    occupation: string | null;
    employment_type: EmploymentType | null;
    avatar_url: string | null;
    city: string | null;
    phone: string | null;
    itc_access: boolean | null;
    // Null on rows that predate the admin-only migration; treat as false.
    is_admin_only: boolean | null;
  } & Record<string, unknown>;
  return {
    ...(row as unknown as SessionUser),
    deactivated_at: row.canceled_at,
    onboarding_step: row.onboarding_step ?? 0,
    occupation: row.occupation,
    employment_type: row.employment_type,
    avatar_url: row.avatar_url,
    city: row.city,
    phone: row.phone,
    is_admin_only: Boolean(row.is_admin_only),
  };
}

/** Whether this session has ITC access. Read once at requireUser, kept
 *  off SessionUser (since not all consumers care), exposed via a
 *  helper for post-onboarding redirect decisions. Column may be null
 *  on rows that predate the auth-phase migration — treat as false. */
export async function currentUserHasItcAccess(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("users")
    .select("itc_access")
    .eq("id", user.id)
    .maybeSingle();
  return Boolean((data as { itc_access: boolean | null } | null)?.itc_access);
}

/**
 * Gate wrapper — call after requireUser() on any protected page.
 * §5 entitlement gate. Read-only (canceled_win_back) still renders pages;
 * write actions must call ensureFullAccess().
 */
export async function requireAccess(options?: {
  allowIncompleteOnboarding?: boolean;
}): Promise<{ user: SessionUser; readOnly: boolean }> {
  const user = await requireUser();
  // Admin-only users never render the coachee shell. Anywhere in
  // the (app) route group calling requireAccess sends them straight
  // to /admin. The /admin routes themselves use requirePlatformAdmin
  // (not requireAccess) so no cycle.
  if (user.is_admin_only) redirect("/admin");
  const decision = canAccess({
    subscription_status: user.subscription_status,
    deactivated_at: user.deactivated_at,
  });
  if (decision.access === "none") redirect("/inactive");
  // Platform admins bypass onboarding — they set the system up, they don't need
  // the guided flow. They can still walk through it manually if they want to.
  if (
    !options?.allowIncompleteOnboarding &&
    !user.is_platform_admin &&
    user.onboarding_step < ONBOARDING_STEPS_TOTAL
  ) {
    redirect(onboardingRouteFor(user.onboarding_step));
  }
  return { user, readOnly: decision.access === "read_only" };
}

/** Total number of onboarding steps in the active wizard flow.
 *
 *  History:
 *   - 7 originally (identity → why → partner → kids → goal → mission
 *     → first-checkin).
 *   - Bumped to 8 with the /onboarding/profile step inserted at step 1.
 *   - Dropped back to 6 (2026-08-24) when goal + mission were hidden.
 *     The pages themselves still exist and can be re-enabled by
 *     restoring them to onboardingRouteFor and bumping this back to 8.
 */
export const ONBOARDING_STEPS_TOTAL = 6;

export function onboardingRouteFor(step: number): string {
  switch (step) {
    case 0: return "/onboarding";
    case 1: return "/onboarding/profile";
    case 2: return "/onboarding/why";
    case 3: return "/onboarding/partner";
    case 4: return "/onboarding/kids";
    case 5: return "/onboarding/first-checkin";
    default: return "/today";
  }
}

export async function ensureFullAccess() {
  const { readOnly } = await requireAccess();
  if (readOnly) throw new Error("Read-only account");
}
