import type { ReactNode } from "react";

export type LeaderboardRow = {
  userId: string;
  name: string;
  primary: string; // main metric shown right-aligned (e.g. "42/56", "8/10 · 88%", "9.4")
  secondary?: string; // small caption under name (e.g. "3 exemplars", "vs 32 last wk")
  delta?: number; // rank change vs prior period (positive = moved up)
  highlight?: boolean; // self row
};

export function LeaderboardCard({
  label,
  title,
  hint,
  rows,
  emptyText,
  accent,
}: {
  label: string;
  title: string;
  hint?: string;
  rows: LeaderboardRow[];
  emptyText?: string;
  accent?: string;
}) {
  const color = accent ?? "var(--color-primary)";
  return (
    <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
      <header
        className="px-6 py-5 border-b border-[color:var(--color-border)]"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <p className="text-[10px] font-heading tracking-widest" style={{ color }}>
          {label}
        </p>
        <p className="font-heading text-xl mt-2">{title}</p>
        {hint ? (
          <p className="text-xs text-[color:var(--color-text-muted)] mt-2 leading-relaxed">
            {hint}
          </p>
        ) : null}
      </header>
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-sm text-[color:var(--color-text-muted)] text-center">
          {emptyText ?? "No data yet."}
        </p>
      ) : (
        <ol className="divide-y divide-[color:var(--color-border)]">
          {rows.map((r, i) => (
            <Row key={r.userId} rank={i + 1} row={r} accentColor={color} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({
  rank,
  row,
  accentColor,
}: {
  rank: number;
  row: LeaderboardRow;
  accentColor: string;
}) {
  const isTop = rank === 1;
  return (
    <li
      className={`px-6 py-4 flex items-center gap-4 ${row.highlight ? "bg-[color:var(--color-surface-2)]" : ""}`}
    >
      <span
        className="font-heading text-xs w-8 text-center shrink-0"
        style={{ color: isTop ? accentColor : "var(--color-text-muted)" }}
      >
        {rankToken(rank)}
      </span>
      <div className="flex-1 min-w-0">
        <p
          className={`truncate leading-snug ${
            isTop ? "font-heading text-base" : "text-sm"
          }`}
        >
          {row.name}
        </p>
        {row.secondary ? (
          <p className="text-[11px] text-[color:var(--color-text-muted)] truncate mt-1">
            {row.secondary}
          </p>
        ) : null}
      </div>
      {row.delta !== undefined && row.delta !== 0 ? <DeltaBadge delta={row.delta} /> : null}
      <span
        className="font-heading text-base shrink-0"
        style={{ color: isTop ? accentColor : "var(--color-text)" }}
      >
        {row.primary}
      </span>
    </li>
  );
}

function rankToken(rank: number): string {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}`;
}

function DeltaBadge({ delta }: { delta: number }) {
  const up = delta > 0;
  const label = up ? `▲${delta}` : `▼${Math.abs(delta)}`;
  const color = up ? "var(--color-primary)" : "var(--color-warning)";
  return (
    <span className="text-[10px] font-heading tracking-widest" style={{ color }}>
      {label}
    </span>
  );
}

export function GridSection({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 md:grid-cols-2">{children}</div>;
}
