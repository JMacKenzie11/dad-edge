import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLARS } from "@/lib/pillars";
import { saveFirstMission } from "../actions";
import { StepProgress } from "../step-progress";

export const dynamic = "force-dynamic";

export default async function MissionStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: membership } = await supabase
    .from("memberships")
    .select("community_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    // No community yet — skip mission + first-checkin and land somewhere useful.
    // Bumping to 7 marks onboarding complete so /today doesn't bounce back here.
    await supabase
      .from("users")
      .update({ onboarding_step: 7 })
      .eq("id", user.id)
      .lt("onboarding_step", 7);
    redirect(user.is_platform_admin ? "/admin" : "/today");
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  return (
    <div>
      <StepProgress step={7} total={8} />
      <h1 className="font-heading text-3xl mb-2">Your first mission.</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        Behavior plus day. That's the format.
      </p>
      <form action={saveFirstMission} className="space-y-4">
        <input type="hidden" name="community_id" value={membership.community_id as string} />
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
            PILLAR
          </p>
          <div className="grid grid-cols-4 gap-2">
            {PILLARS.map((p, i) => (
              <label
                key={p.code}
                className="flex flex-col items-center py-2 rounded-md border border-[color:var(--color-border)] cursor-pointer"
              >
                <input
                  type="radio"
                  name="pillar_code"
                  value={p.code}
                  defaultChecked={i === 0}
                  className="sr-only peer"
                />
                <span
                  className="h-8 w-8 rounded-md flex items-center justify-center font-heading text-sm"
                  style={{ background: p.colorVar, color: "black" }}
                >
                  {p.code === "A2" ? "A" : p.code}
                </span>
                <span className="text-[10px] font-heading tracking-widest mt-1 text-[color:var(--color-text-muted)]">
                  {p.short.toUpperCase()}
                </span>
              </label>
            ))}
          </div>
        </div>
        <textarea
          name="description"
          rows={2}
          required
          className="w-full p-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          placeholder="Take Sarah on a date night."
        />
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            WHEN
          </span>
          <input
            type="date"
            name="target_date"
            defaultValue={tomorrowISO}
            required
            className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        </label>
        {params.error ? (
          <p className="text-xs text-[color:var(--color-danger)]" role="alert">
            {params.error}
          </p>
        ) : null}
        <button
          type="submit"
          className="w-full h-12 rounded-md font-heading bg-[color:var(--color-primary)] text-white"
        >
          Lock it in
        </button>
      </form>
    </div>
  );
}
