import { requireUser } from "@/lib/session";
import { saveWhy } from "../actions";
import { StepProgress } from "../step-progress";

export const dynamic = "force-dynamic";

export default async function WhyStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  return (
    <div>
      <StepProgress step={2} total={7} />
      <h1 className="font-heading text-3xl mb-2">What made you say yes to this?</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        Your coach reads this first.
      </p>
      <form action={saveWhy} className="space-y-4">
        <textarea
          name="why"
          rows={5}
          required
          minLength={8}
          defaultValue={user.email ? "" : ""}
          className="w-full p-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          placeholder="I'm sick of half-showing-up for Sarah and the kids."
        />
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
