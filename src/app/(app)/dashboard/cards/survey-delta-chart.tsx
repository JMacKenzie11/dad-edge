"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function SurveyDeltaChart({
  data,
}: {
  data: Array<{ taken: string; composite: number }>;
}) {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="taken"
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <YAxis
            domain={[1, 5]}
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--color-text)" }}
          />
          <Line
            type="monotone"
            dataKey="composite"
            stroke="var(--color-pillar-b)"
            strokeWidth={2}
            dot={{ fill: "var(--color-pillar-b)", r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
