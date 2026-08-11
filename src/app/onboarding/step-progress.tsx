export function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
        <span>STEP {step} OF {total}</span>
        <span>{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="h-1 bg-[color:var(--color-surface)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[color:var(--color-accent)] transition-all"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
