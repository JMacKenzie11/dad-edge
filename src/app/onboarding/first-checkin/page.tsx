import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/scoring/week";
import { FirstCheckinForm } from "./first-checkin-form";
import { StepProgress } from "../step-progress";

export const dynamic = "force-dynamic";

export default async function FirstCheckinStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const today = localDate(new Date(), user.timezone);
  const params = await searchParams;
  return (
    <div>
      <StepProgress step={6} total={6} />
      <h1 className="font-heading text-3xl mb-2">Log today.</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        Day one is never a zero. Tap once for done, twice for missed.
      </p>
      <FirstCheckinForm date={today} error={params.error} />
    </div>
  );
}
