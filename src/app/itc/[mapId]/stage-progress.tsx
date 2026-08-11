import { ITC_STAGES, STAGE_LABELS, stageIndex, type ItcStage } from "@/lib/itc/stage";

// Stages surfaced in the progress bar. The database has more (test_running,
// done, etc.) but the header only needs the milestones the coachee sees.
const HEADER_STAGES: ItcStage[] = [
  "goal",
  "behaviors",
  "worries",
  "commitments",
  "assumptions",
  "review",
  "immune_system",
  "prioritize",
  "test_design",
  "results",
];

export function StageProgress({ current }: { current: ItcStage }) {
  const currentIdx = stageIndex(current);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto overflow-y-visible py-2 text-[11px] uppercase tracking-wide">
      {HEADER_STAGES.map((stage, i) => {
        const idx = ITC_STAGES.indexOf(stage);
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "todo";
        return (
          <li
            key={stage}
            className={
              "shrink-0 px-2.5 py-1 rounded-full border " +
              (state === "active"
                ? "border-[color:var(--color-primary)] text-white bg-[color:var(--color-primary)]/20"
                : state === "done"
                  ? "border-[color:var(--color-border)] text-[color:var(--color-muted)]"
                  : "border-transparent text-[color:var(--color-muted)]/60")
            }
          >
            {STAGE_LABELS[stage]}
          </li>
        );
      })}
    </ol>
  );
}
