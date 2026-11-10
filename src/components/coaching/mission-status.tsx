import type { CoachMission } from "@/lib/coaching/signals";

const TEXT: Record<CoachMission["status"], string> = {
  completed: "Done",
  missed: "Missed",
  rolled_over: "Rolled over",
  planned: "Planned",
};

const COLOR: Record<CoachMission["status"], string> = {
  completed: "var(--color-success)",
  missed: "var(--color-danger)",
  rolled_over: "var(--color-warning)",
  planned: "var(--color-text-muted)",
};

export function MissionStatus({ mission }: { mission: Pick<CoachMission, "status" | "completed_late"> }) {
  const text = mission.status === "completed" && mission.completed_late ? "Done late" : TEXT[mission.status];
  return (
    <span className="font-heading text-[10px] tracking-widest" style={{ color: COLOR[mission.status] }}>
      {text.toUpperCase()}
    </span>
  );
}
