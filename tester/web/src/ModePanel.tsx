import type { Mode, ShieldStats } from "./types";
import { StatTile } from "./StatTile";
import { RequestsChart, type RequestPoint } from "./RequestsChart";
import { VisitorsChart, type VisitorPoint } from "./VisitorsChart";
import { formatDuration } from "./lib";

export type FooterItem = { label: string; value: string };

export type ModePanelProps = {
  mode: Mode;
  label: string;
  running: boolean;
  accent: "ok" | "failed";
  /** null = this mode has never run this session. */
  failedValue: number | null;
  elapsedS: number;
  /** Highest number of visitors on the waiting page at once; null = never run (shown as "–"). */
  queuedPeak: number | null;
  requestData: RequestPoint[];
  visitorData: VisitorPoint[];
  xDomain: [number, number];
  xTicks: number[];
  requestsYDomain: [number, number];
  visitorsYDomain: [number, number];
  footer: FooterItem[];
  /** With panel only: live Shield stats (header "Active x / y" and the threshold line); null = offline. */
  shield?: ShieldStats | null;
};

export function ModePanel(props: ModePanelProps) {
  const {
    label,
    running,
    accent,
    failedValue,
    elapsedS,
    queuedPeak,
    requestData,
    visitorData,
    xDomain,
    xTicks,
    requestsYDomain,
    visitorsYDomain,
    footer,
    shield,
  } = props;

  const failedTone = failedValue === null ? "muted" : failedValue > 0 ? "bad" : "ok";

  return (
    <section className={`mode-panel accent-${accent}`}>
      <div className="mode-panel-header">
        <h2>{label}</h2>
        {shield && (
          <span className="shield-active">
            Active <b>{shield.active} / {shield.threshold}</b>
          </span>
        )}
        {running && (
          <span className={`running-badge running-${accent}`}>
            <span className="running-dot" /> RUNNING
          </span>
        )}
      </div>

      <div className="stat-row">
        <StatTile label="Failed" value={failedValue === null ? "–" : failedValue} tone={failedTone} size="xl" />
        <StatTile label="Time" value={formatDuration(elapsedS)} size="lg" />
        <StatTile
          label="Queued (peak)"
          value={queuedPeak === null ? "–" : queuedPeak}
          tone={queuedPeak === null ? "muted" : "default"}
          size="lg"
        />
      </div>

      <div className="charts-area">
        <RequestsChart data={requestData} xDomain={xDomain} xTicks={xTicks} yDomain={requestsYDomain} />
        <VisitorsChart data={visitorData} xDomain={xDomain} xTicks={xTicks} yDomain={visitorsYDomain} threshold={shield?.threshold ?? null} />
      </div>

      <div className="mode-footer">
        {footer.map((item) => (
          <div className="footer-item" key={item.label}>
            <span className="footer-label">{item.label}</span>
            <span className="footer-value">{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
