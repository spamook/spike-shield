import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { yTicks } from "./lib";

const tooltipStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 12,
};

const axisTick = { fill: "var(--muted)", fontSize: 12 };

export type RequestPoint = { t: number; ok: number; failed: number };

export type RequestsChartProps = {
  data: RequestPoint[];
  xDomain: [number, number];
  xTicks: number[];
  yDomain: [number, number];
};

export function RequestsChart({ data, xDomain, xTicks, yDomain }: RequestsChartProps) {
  return (
    <div className="chart-wrap">
      <div className="chart-header">
        <span className="chart-title">Requests / s</span>
        <span className="chart-legend">
          <span className="legend-item">
            <i className="legend-swatch" style={{ background: "var(--ok)" }} />
            OK
          </span>
          <span className="legend-item">
            <i className="legend-swatch" style={{ background: "var(--failed)" }} />
            Failed
          </span>
        </span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          {/* Recharts draws no axes for an empty data array: give it two empty points at the window edges. */}
          <AreaChart data={data.length > 0 ? data : ([{ t: xDomain[0], axis: 0 }, { t: xDomain[1], axis: 0 }] as unknown as RequestPoint[])} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
            {/* Invisible series: gives the y-axis a value to render with when there is no data. */}
            <Area dataKey="axis" stroke="none" fill="none" tooltipType="none" legendType="none" activeDot={false} isAnimationActive={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => `t = ${t}s`} isAnimationActive={false} />
            <Area
              type="linear"
              dataKey="ok"
              name="OK"
              stroke="var(--ok)"
              fill="var(--ok)"
              fillOpacity={0.15}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="failed"
              name="Failed"
              stroke="var(--failed)"
              fill="var(--failed)"
              fillOpacity={0.15}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
