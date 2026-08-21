import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewGoalForm } from "./new-goal-form";
import { GoalCard } from "./goal-card";
import { EmptyState } from "@/components/ui/empty-state";
import type { PillarCode } from "@/lib/pillars";

export const dynamic = "force-dynamic";

type Goal = {
  id: string;
  description: string;
  focus_area: PillarCode;
  quarter_start: string;
  status: "active" | "completed" | "abandoned";
  source: "user" | "itc";
};

/** Cap on user-authored active goals per quarter. The DB trigger
 *  enforce_active_goals_cap enforces this; UI mirrors so the form
 *  disables with a clear reason instead of hitting a server rejection. */
const USER_GOAL_SLOTS = 2;

export default async function GoalsPage() {
  const { user, readOnly } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("quarterly_goals")
    .select("id, description, focus_area, quarter_start, status, source")
    .eq("user_id", user.id)
    .order("quarter_start", { ascending: false });

  const rows = (data ?? []) as Goal[];
  const active = rows.filter((g) => g.status === "active");
  const closed = rows.filter((g) => g.status !== "active");
  const currentQuarterStart = currentQuarter();
  const activeUserGoalsThisQuarter = active.filter(
    (g) => g.source === "user" && g.quarter_start === currentQuarterStart,
  ).length;
  const userSlotsRemaining = Math.max(
    0,
    USER_GOAL_SLOTS - activeUserGoalsThisQuarter,
  );

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          NINETY-DAY HORIZON
        </p>
        <h1 className="font-heading text-3xl">Quarterly goals</h1>
      </header>

      {!readOnly ? (
        <NewGoalForm
          currentQuarterStart={currentQuarterStart}
          userSlotsRemaining={userSlotsRemaining}
        />
      ) : null}

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">Active</h2>
        {active.length === 0 ? (
          <EmptyState title="Nothing on the horizon." body="Pick one pillar. Write one goal." />
        ) : (
          <div className="space-y-3">
            {active.map((g) => (
              <GoalCard key={g.id} goal={g} readOnly={readOnly} />
            ))}
          </div>
        )}
      </section>

      {closed.length > 0 ? (
        <section>
          <h2 className="font-heading text-lg text-[color:var(--color-text-muted)] mb-3">
            History
          </h2>
          <div className="space-y-3">
            {closed.map((g) => (
              <GoalCard key={g.id} goal={g} readOnly />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function currentQuarter(): string {
  const now = new Date();
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3);
  const month = q * 3 + 1;
  return `${y}-${String(month).padStart(2, "0")}-01`;
}
