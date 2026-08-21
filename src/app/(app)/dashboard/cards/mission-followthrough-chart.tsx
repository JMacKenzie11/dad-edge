"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function MissionFollowThroughChart({
  data,
}: {
  data: Array<{ week: string; onTime: number; late: number }>;
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="week"
            tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <YAxis
            domain={[0, 100]}
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
          <Legend
            wrapperStyle={{ fontSize: 11, color: "var(--color-text-muted)" }}
          />
          <Area
            type="monotone"
            dataKey="onTime"
            name="On time %"
            stackId="1"
            stroke="var(--color-primary)"
            fill="var(--color-primary)"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="late"
            name="Late %"
            stackId="1"
            stroke="var(--color-warning)"
            fill="var(--color-warning)"
            fillOpacity={0.4}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
