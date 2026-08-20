"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * Client-side filtered list of maps for the admin index. Filter matches
 * the coachee email or the goal text (case-insensitive, substring).
 * Stage filter is a dropdown of the ITC stage labels + "All stages".
 *
 * Server-side alternative would use URL params; going client-side so
 * every keystroke is instant against the in-memory list.
 */
export type AdminMapListRow = {
  mapId: string;
  email: string;
  goal: string | null;
  stageLabel: string;
  currentStage: string;
  pillarLabel: string;
  pillarColorVar: string;
  status: string;
  updatedAtIso: string;
};

export function AdminMapsList({ rows }: { rows: AdminMapListRow[] }) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");

  const stages = useMemo(() => {
    const s = new Map<string, string>(); // currentStage → stageLabel
    for (const r of rows) s.set(r.currentStage, r.stageLabel);
    return Array.from(s.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stageFilter && r.currentStage !== stageFilter) return false;
      if (!q) return true;
      return (
        r.email.toLowerCase().includes(q) ||
        (r.goal ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, stageFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by email or goal…"
          className="flex-1 min-w-[220px] rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
        >
          <option value="">All stages</option>
          {stages.map(([stage, label]) => (
            <option key={stage} value={stage}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-xs text-[color:var(--color-muted)]">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">
          No maps match.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.mapId}>
              <Link
                href={`/itc/admin/${r.mapId}`}
                className="block rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 hover:border-[color:var(--color-primary)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {r.email}
                      </span>
                      <span
                        className="text-[11px] uppercase tracking-wide"
                        style={{ color: r.pillarColorVar }}
                      >
                        {r.pillarLabel}
                      </span>
                      <span className="text-[11px] rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[color:var(--color-muted)]">
                        {r.stageLabel}
                      </span>
                      <span className="text-[11px] text-[color:var(--color-muted)]/80">
                        {r.status}
                      </span>
                    </div>
                    <div className="text-xs text-[color:var(--color-muted)] truncate">
                      {r.goal ?? "Goal not yet locked."}
                    </div>
                  </div>
                  <div className="text-[11px] text-[color:var(--color-muted)] whitespace-nowrap">
                    {new Date(r.updatedAtIso).toLocaleString()}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
