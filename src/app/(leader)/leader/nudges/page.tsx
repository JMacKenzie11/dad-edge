import { resolveLeaderCommunity } from "@/lib/leader-context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { updateNudgeSettings } from "../actions";

export const dynamic = "force-dynamic";

export default async function LeaderNudgesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const { communityId, communityName } = await resolveLeaderCommunity(sp);
  const svc = createSupabaseServiceClient();

  const { data: settings } = await svc
    .from("nudge_settings")
    .select("daily_reminder_time, disengagement_ladder")
    .eq("community_id", communityId)
    .maybeSingle();

  const s = (settings as {
    daily_reminder_time: string;
    disengagement_ladder: { day3?: boolean; day7?: boolean; day14?: boolean };
  } | null) ?? {
    daily_reminder_time: "18:00",
    disengagement_ladder: { day3: true, day7: true, day14: true },
  };

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl">Nudge settings</h1>
        <span className="text-xs text-[color:var(--color-text-muted)]">{communityName}</span>
      </header>

      {sp.saved ? <p className="text-xs text-[color:var(--color-success)]">Saved.</p> : null}

      <form
        action={updateNudgeSettings}
        className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-4 max-w-lg"
      >
        <input type="hidden" name="community_id" value={communityId} />
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
            DAILY REMINDER TIME
          </span>
          <input
            type="time"
            name="daily_reminder_time"
            defaultValue={s.daily_reminder_time.slice(0, 5)}
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] w-32"
          />
        </label>
        <fieldset className="space-y-2 text-sm">
          <legend className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
            DISENGAGEMENT LADDER
          </legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="day3" defaultChecked={s.disengagement_ladder.day3 ?? true} />
            <span>Day 3 — gentle email nudge</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="day7" defaultChecked={s.disengagement_ladder.day7 ?? true} />
            <span>Day 7 — direct email nudge</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="day14" defaultChecked={s.disengagement_ladder.day14 ?? true} />
            <span>Day 14 — leader is emailed to reach out personally</span>
          </label>
        </fieldset>
        <button className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest">
          SAVE
        </button>
      </form>
    </div>
  );
}
