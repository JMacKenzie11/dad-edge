"use client";

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
 * check-in totals per pillar. Two bars per pillar (or one when there's
 * no last-quarter data). Full pillar names on the x-axis so the chart
 * is legible without needing to know the BRAVEMAN codes by heart.
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
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: -20, bottom: 24 }}
        >
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="pillar"
            tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
            angle={-25}
            textAnchor="end"
            interval={0}
            height={44}
          />
          <YAxis
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
            allowDecimals={false}
            label={{
              value: "Check-ins",
              angle: -90,
              position: "insideLeft",
              offset: 20,
              fill: "var(--color-text-muted)",
              fontSize: 11,
            }}
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
    </div>
  );
}
