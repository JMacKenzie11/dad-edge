"use client";

import { PILLARS } from "@/lib/pillars";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Grouped bar chart: this-quarter vs last-quarter Daily Living
 * check-in totals per pillar. Two bars per pillar, colored via
 * pillar tokens. Recharts is client-only so this is a client
 * component; the parent server card fetches + shapes the data.
 */
export function PillarComparisonChart({
  data,
  hasLastQuarter,
}: {
  data: Array<{
    pillar: string;
    thisQuarter: number;
    lastQuarter: number;
  }>;
  hasLastQuarter: boolean;
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="pillar"
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <YAxis
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--color-border)", opacity: 0.2 }}
            contentStyle={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--color-text)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "var(--color-text-muted)" }}
          />
          <Bar
            dataKey="thisQuarter"
            name="This quarter"
            fill="var(--color-primary)"
            radius={[4, 4, 0, 0]}
          />
          {hasLastQuarter ? (
            <Bar
              dataKey="lastQuarter"
              name="Last quarter"
              fill="var(--color-text-muted)"
              radius={[4, 4, 0, 0]}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
      <div className="hidden">
        {/* Reference PILLARS so the pillar sort_order is deterministic
            even when the data has zeros. */}
        {PILLARS.map((p) => p.code).join(",")}
      </div>
    </div>
  );
}
