"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PillarCode } from "@/lib/pillars";
import { PILLAR_BY_CODE } from "@/lib/pillars";

/**
 * Weekly Daily Living check-in count (0-56) as a line across the
 * user's full history. Quarterly goal windows are overlaid as
 * pillar-colored shaded bands so the reader can see which weeks
 * fell inside which active-goal period without an explicit label
 * (labels stack awkwardly on adjacent quarters).
 */
export function DailyLivingTrendChart({
  data,
  goalBands,
}: {
  data: Array<{ week: string; total: number }>;
  goalBands: Array<{
    startWeek: string;
    endWeek: string;
    pillar: PillarCode;
  }>;
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="week"
            tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <YAxis
            domain={[0, 56]}
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            tickLine={{ stroke: "var(--color-border)" }}
            axisLine={{ stroke: "var(--color-border)" }}
            label={{
              value: "Check-ins / 56",
              angle: -90,
              position: "insideLeft",
              offset: 20,
              fill: "var(--color-text-muted)",
              fontSize: 11,
            }}
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
          {goalBands.map((band, i) => (
            <ReferenceArea
              key={`band-${i}`}
              x1={band.startWeek}
              x2={band.endWeek}
              y1={0}
              y2={56}
              fill={PILLAR_BY_CODE[band.pillar].colorVar}
              fillOpacity={0.1}
              stroke={PILLAR_BY_CODE[band.pillar].colorVar}
              strokeOpacity={0.25}
            />
          ))}
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={{ fill: "var(--color-primary)", r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
