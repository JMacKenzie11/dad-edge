import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { EditGoalForm } from "./edit-goal-form";

export const dynamic = "force-dynamic";

type Mission = {
  id: string;
  description: string;
  target_date: string;
  status: "planned" | "completed" | "missed" | "rolled_over" | "abandoned";
  completed_late: boolean;
  pillar_code: PillarCode;
};

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, readOnly } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const { data: goal } = await supabase
    .from("quarterly_goals")
    .select(
      "id, focus_area, quarter_start, status, source, current_state, desired_end_state, midpoint_check_answer, retrospective_what_happened, retrospective_what_learned",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!goal) notFound();

  const { data: missionRows } = await supabase
    .from("missions")
    .select(
      "id, description, target_date, status, completed_late, pillar_code",
    )
    .eq("user_id", user.id)
    .eq("quarterly_goal_id", id)
    .order("target_date", { ascending: true });

  const missions = (missionRows ?? []) as Mission[];
  const p = PILLAR_BY_CODE[goal.focus_area as PillarCode];
  const itcSourced = goal.source === "itc";
  const canEdit = !readOnly && !itcSourced && goal.status === "active";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/goals"
          className="text-xs text-[color:var(--color-text-muted)] hover:text-white"
        >
          ← Back to goals
        </Link>
      </div>

      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {p.label.toUpperCase()} · Q START {goal.quarter_start}
        </p>
        <h1 className="font-heading text-2xl mt-1">{goal.desired_end_state}</h1>
      </header>

      {itcSourced ? (
        <div className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
          <p className="text-sm">
            This goal is managed by your ITC map. Editing happens in the ITC tool.
          </p>
          <p className="text-xs text-[color:var(--color-primary)] mt-2">
            <Link href="/itc">Open your ITC maps →</Link>
          </p>
        </div>
      ) : canEdit ? (
        <EditGoalForm
          goal={{
            id: goal.id as string,
            current_state: (goal.current_state as string | null) ?? "",
            desired_end_state: goal.desired_end_state as string,
          }}
        />
      ) : (
        <div className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3">
          {goal.current_state ? (
            <FieldReadout label="Where you are now" value={goal.current_state as string} />
          ) : null}
          <FieldReadout label="Where you want to be" value={goal.desired_end_state as string} />
          {goal.midpoint_check_answer ? (
            <FieldReadout label="Midpoint check-in" value={goal.midpoint_check_answer as string} />
          ) : null}
          {goal.retrospective_what_happened ? (
            <FieldReadout
              label="What actually happened"
              value={goal.retrospective_what_happened as string}
            />
          ) : null}
          {goal.retrospective_what_learned ? (
            <FieldReadout
              label="What you learned"
              value={goal.retrospective_what_learned as string}
            />
          ) : null}
        </div>
      )}

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">
          Mission timeline
        </h2>
        {missions.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] italic">
            No missions attached to this goal yet.
          </p>
        ) : (
          <ol className="space-y-2 border-l border-[color:var(--color-border)] pl-4">
            {missions.map((m) => (
              <MissionTimelineEntry key={m.id} mission={m} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function FieldReadout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        {label.toUpperCase()}
      </p>
      <p className="text-sm mt-1 leading-relaxed">{value}</p>
    </div>
  );
}

function MissionTimelineEntry({ mission }: { mission: Mission }) {
  const statusColor =
    mission.status === "completed"
      ? "text-emerald-400"
      : mission.status === "missed"
        ? "text-[color:var(--color-danger)]"
        : mission.status === "abandoned"
          ? "text-[color:var(--color-text-muted)]"
          : "text-[color:var(--color-text-muted)]";
  return (
    <li className="text-sm">
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] tabular-nums text-[color:var(--color-text-muted)] shrink-0">
          {mission.target_date}
        </span>
        <span className="flex-1">{mission.description}</span>
        <span className={`text-[10px] font-heading tracking-widest ${statusColor}`}>
          {mission.status.toUpperCase()}
          {mission.completed_late ? " · LATE" : ""}
        </span>
      </div>
    </li>
  );
}
