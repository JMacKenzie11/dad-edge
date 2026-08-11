import { createCommunity } from "./actions";

export function CreateCommunityForm() {
  return (
    <form
      action={createCommunity}
      className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] grid gap-3 md:grid-cols-[1fr_1fr_1fr_100px_120px]"
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">NAME</span>
        <input
          name="name"
          required
          minLength={2}
          maxLength={80}
          placeholder="Basecamp"
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">SLUG</span>
        <input
          name="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="basecamp"
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">TIMEZONE</span>
        <input
          name="timezone"
          defaultValue="America/Chicago"
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">LOCK DAYS</span>
        <input
          name="week_lock_days"
          type="number"
          min={0}
          max={14}
          defaultValue={3}
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        />
      </label>
      <button
        type="submit"
        className="h-10 self-end px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest"
      >
        CREATE
      </button>
    </form>
  );
}
