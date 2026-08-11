import Link from "next/link";
import { savePartner, skipPartner } from "../actions";
import { StepProgress } from "../step-progress";

export const dynamic = "force-dynamic";

const LABELS = ["wife", "partner", "girlfriend", "fiancee", "husband", "boyfriend"] as const;

export default async function PartnerStep() {
  return (
    <div>
      <StepProgress step={3} total={7} />
      <h1 className="font-heading text-3xl mb-2">Your partner.</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        Optional. Only you see this. Your coach uses it. Your group never does.
      </p>
      <form action={savePartner} className="space-y-4">
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">NAME</span>
          <input name="partner_name" className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
        </label>
        <label className="block">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">RELATIONSHIP</span>
          <select name="relationship_label" className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
            <option value="">—</option>
            {LABELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">HER BIRTHDAY</span>
            <input type="date" name="partner_birthdate" className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
          </label>
          <label className="block">
            <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">ANNIVERSARY</span>
            <input type="date" name="relationship_date" className="mt-1 w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
          </label>
        </div>

        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
            A FEW THINGS YOU LOVE MOST ABOUT HER
          </p>
          <div className="space-y-2">
            <input name="loved_1" placeholder="How she makes strangers feel welcome." className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
            <input name="loved_2" placeholder="…" className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
            <input name="loved_3" placeholder="…" className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="flex-1 h-12 rounded-md font-heading bg-[color:var(--color-primary)] text-white"
          >
            Next
          </button>
          <button
            type="button"
            formAction={skipPartner}
            className="h-12 px-4 rounded-md font-heading text-[color:var(--color-text-muted)] border border-[color:var(--color-border)]"
          >
            Skip
          </button>
        </div>
      </form>
      <p className="text-[11px] text-[color:var(--color-text-muted)] mt-4">
        <Link href="/onboarding/kids" className="underline">Add later from Me</Link>
      </p>
    </div>
  );
}
