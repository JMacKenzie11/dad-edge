import { format } from "date-fns";
import { StepProgress } from "../step-progress";
import { GoalForm } from "./goal-form";

export const dynamic = "force-dynamic";

function currentQuarterInfo(now: Date = new Date()): {
  quarterNumber: number;
  year: number;
  startISO: string;
  endLabel: string;
  daysRemaining: number;
} {
  const q = Math.floor(now.getMonth() / 3);
  const year = now.getFullYear();
  const start = new Date(year, q * 3, 1);
  const end = new Date(year, q * 3 + 3, 0);
  const daysRemaining = Math.max(
    0,
    Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );
  return {
    quarterNumber: q + 1,
    year,
    startISO: format(start, "yyyy-MM-dd"),
    endLabel: format(end, "MMMM d, yyyy"),
    daysRemaining,
  };
}

export default async function GoalStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const quarter = currentQuarterInfo();
  return (
    <div>
      <StepProgress step={6} total={8} />
      <h1 className="font-heading text-3xl mb-2">
        Your Q{quarter.quarterNumber} goal.
      </h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        Pick one pillar. Write one goal you'll close before the quarter ends.
      </p>
      <div className="mb-6 p-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          DEADLINE
        </p>
        <p className="text-sm">
          <span className="font-heading">{quarter.endLabel}</span>
          <span className="text-[color:var(--color-text-muted)]">
            {" "}· {quarter.daysRemaining} day{quarter.daysRemaining === 1 ? "" : "s"} left in Q{quarter.quarterNumber}
          </span>
        </p>
      </div>
      <GoalForm initialError={params.error} />
    </div>
  );
}
