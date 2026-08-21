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
 * Composite score weekly trend with quarterly goal windows overlaid
 * as pillar-colored bands. Goal windows are drawn behind the line
 * via ReferenceArea so the coach can see which weeks fell inside
 * which active-goal periods.
 */
export function CompositeTrendChart({
  data,
  goalBands,
}: {
  data: Array<{ week: string; composite: number }>;
  goalBands: Array<{
    startWeek: string;
    endWeek: string;
    pillar: PillarCode;
    label: string;
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
          {goalBands.map((band, i) => (
            <ReferenceArea
              key={`band-${i}`}
              x1={band.startWeek}
              x2={band.endWeek}
              y1={0}
              y2={100}
              fill={PILLAR_BY_CODE[band.pillar].colorVar}
              fillOpacity={0.12}
              stroke={PILLAR_BY_CODE[band.pillar].colorVar}
              strokeOpacity={0.3}
              label={{
                value: band.label,
                position: "insideTopLeft",
                fill: "var(--color-text-muted)",
                fontSize: 10,
              }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="composite"
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
