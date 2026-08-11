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
  subscription_status: SubscriptionStatus;
  deactivated_at: string | null;
  onboarding_step: number;
  occupation: string | null;
  employment_type: EmploymentType | null;
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
    .select("id, email, first_name, last_name, timezone, is_platform_admin, subscription_status, canceled_at, onboarding_step, occupation, employment_type")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) redirect("/login");
  const row = data as {
    canceled_at: string | null;
    onboarding_step: number | null;
    occupation: string | null;
    employment_type: EmploymentType | null;
  } & Record<string, unknown>;
  return {
    ...(row as unknown as SessionUser),
    deactivated_at: row.canceled_at,
    onboarding_step: row.onboarding_step ?? 0,
    occupation: row.occupation,
    employment_type: row.employment_type,
  };
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
    user.onboarding_step < 7
  ) {
    redirect(onboardingRouteFor(user.onboarding_step));
  }
  return { user, readOnly: decision.access === "read_only" };
}

export function onboardingRouteFor(step: number): string {
  switch (step) {
    case 0: return "/onboarding";
    case 1: return "/onboarding/why";
    case 2: return "/onboarding/partner";
    case 3: return "/onboarding/kids";
    case 4: return "/onboarding/goal";
    case 5: return "/onboarding/mission";
    case 6: return "/onboarding/first-checkin";
    default: return "/today";
  }
}

export async function ensureFullAccess() {
  const { readOnly } = await requireAccess();
  if (readOnly) throw new Error("Read-only account");
}
