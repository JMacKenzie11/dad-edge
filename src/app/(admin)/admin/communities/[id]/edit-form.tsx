import { SubmitButton } from "@/components/ui/submit-button";
import { updateCommunity } from "../actions";

export function EditCommunityForm({
  community,
}: {
  community: {
    id: string;
    name: string;
    timezone: string;
    week_lock_days: number;
    leaderboard_enabled: boolean;
    missions_visible: boolean;
    status: "active" | "archived";
  };
}) {
  return (
    <form
      action={updateCommunity}
      className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] grid gap-3 md:grid-cols-2"
    >
      <input type="hidden" name="id" value={community.id} />
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">NAME</span>
        <input
          name="name"
          defaultValue={community.name}
          required
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">TIMEZONE</span>
        <input
          name="timezone"
          defaultValue={community.timezone}
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
          EDIT GRACE (DAYS)
        </span>
        <input
          name="week_lock_days"
          type="number"
          min={0}
          max={14}
          defaultValue={community.week_lock_days}
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        />
        <span className="text-[10px] text-[color:var(--color-text-muted)] normal-case">
          Members can edit a past week's check-ins for this many days
          after it ends.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">STATUS</span>
        <select
          name="status"
          defaultValue={community.status}
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          name="leaderboard_enabled"
          defaultChecked={community.leaderboard_enabled}
        />
        <span>Leaderboard enabled</span>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          name="missions_visible"
          defaultChecked={community.missions_visible}
        />
        <span>Missions visible to group</span>
      </label>
      <div className="md:col-span-2 flex justify-end">
        <SubmitButton
          label="SAVE CHANGES"
          pendingLabel="SAVING…"
          className="text-xs"
        />
      </div>
    </form>
  );
}
