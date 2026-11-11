import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentUserHasItcAccess } from "@/lib/session";

/** Move him to step `next`, never backwards. Runs as him (RLS: own row). */
export async function advanceOnboarding(userId: string, next: number): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.from("users").update({ onboarding_step: next }).eq("id", userId).lt("onboarding_step", next);
}

/** Where the finished wizard drops him: ITC users back on /itc, the rest on /today. */
export async function wizardExit(): Promise<string> {
  return (await currentUserHasItcAccess()) ? "/itc" : "/today";
}
