import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PageState } from "./types";
import { STATE_COLORS, STATE_LABELS, STATE_ORDER, yTicks } from "./lib";

const tooltipStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 12,
};

const axisTick = { fill: "var(--muted)", fontSize: 12 };

export type VisitorPoint = { t: number } & Record<PageState, number>;

export type VisitorsChartProps = {
  data: VisitorPoint[];
  xDomain: [number, number];
  xTicks: number[];
  yDomain: [number, number];
  /** Shield threshold, drawn as a dashed line; null = no line (Without panel or Shield offline). */
  threshold?: number | null;
};

export function VisitorsChart({ data, xDomain, xTicks, yDomain, threshold }: VisitorsChartProps) {
  return (
    <div className="chart-wrap">
      <div className="chart-header">
        <span className="chart-title">Users by state</span>
        <span className="chart-legend">
          {STATE_ORDER.map((state) => (
            <span className="legend-item" key={state}>
              <i className="legend-swatch" style={{ background: STATE_COLORS[state] }} />
              {STATE_LABELS[state]}
            </span>
          ))}
        </span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          {/* Recharts draws no axes for an empty data array: give it two empty points at the window edges. */}
          <AreaChart data={data.length > 0 ? data : ([{ t: xDomain[0] }, { t: xDomain[1] }] as VisitorPoint[])} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid horizontal vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={xDomain}
              ticks={xTicks}
              allowDecimals={false}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
            />
            <YAxis domain={yDomain} ticks={yTicks(yDomain)} allowDecimals={false} width={40} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => `t = ${t}s`} isAnimationActive={false} />
            {STATE_ORDER.map((state) => (
              <Area
                key={state}
                type="linear"
                dataKey={state}
                name={STATE_LABELS[state]}
                stackId="visitors"
                stroke={STATE_COLORS[state]}
                fill={STATE_COLORS[state]}
                fillOpacity={0.6}
                strokeWidth={0}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            {threshold != null && (
              <ReferenceLine
                y={threshold}
                stroke="var(--text)"
                strokeDasharray="6 4"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
                label={{ value: `Shield limit ${threshold}`, position: "insideTopRight", fill: "var(--text)", fontSize: 12 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
