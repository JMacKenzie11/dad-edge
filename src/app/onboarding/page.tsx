import { requireUser } from "@/lib/session";
import { saveIdentity } from "./actions";
import { StepProgress } from "./step-progress";

export const dynamic = "force-dynamic";

const COMMON_TZ = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "America/Halifax",
  "America/Toronto",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
];

export default async function OnboardingStart({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  return (
    <div>
      <StepProgress step={1} total={6} />
      <h1 className="font-heading text-3xl mb-2">Who are you?</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        Basics your coach uses. Not a settings form.
      </p>
      <form action={saveIdentity} className="space-y-4">
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">FIRST NAME</span>
          <input
            name="first_name"
            required
            defaultValue={user.first_name ?? ""}
            className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">LAST NAME</span>
          <input
            name="last_name"
            defaultValue={user.last_name ?? ""}
            className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">TIMEZONE</span>
          <select
            name="timezone"
            defaultValue={user.timezone}
            className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          >
            {COMMON_TZ.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            WHAT DO YOU DO FOR A LIVING?
          </span>
          <input
            name="occupation"
            defaultValue={user.occupation ?? ""}
            placeholder="Software engineer, electrician, sales director…"
            maxLength={120}
            className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        </label>
        <fieldset className="block">
          <legend className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
            EMPLOYMENT
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["w2", "W2 employee"],
                ["contract", "Contractor"],
                ["self_employed", "Self-employed"],
                ["business_owner", "Business owner"],
                ["other", "Other"],
              ] as const
            ).map(([value, label]) => {
              const selected = (user.employment_type ?? "") === value;
              return (
                <label
                  key={value}
                  className={`flex items-center gap-2 h-11 px-3 rounded-md border cursor-pointer text-sm ${
                    selected
                      ? "border-[color:var(--color-primary)] bg-[color:var(--color-surface)]"
                      : "border-[color:var(--color-border)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="employment_type"
                    value={value}
                    defaultChecked={selected}
                    className="accent-[color:var(--color-primary)]"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>
        {params.error ? <p className="text-xs text-[color:var(--color-danger)]">{params.error}</p> : null}
        <button
          type="submit"
          className="w-full h-12 rounded-md font-heading bg-[color:var(--color-primary)] text-white"
        >
          Next
        </button>
      </form>
    </div>
  );
}
