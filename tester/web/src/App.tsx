import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type { Mode } from "./types";
import { useLive } from "./useLive";
import { ModePanel, type FooterItem } from "./ModePanel";
import {
  DEFAULT_USERS,
  MAX_USERS,
  VISITORS_Y_MAX,
  REQUESTS_Y_MIN_MAX,
  MODE_LABELS,
  clampUsers,
  computeModeWindow,
  formatPercent0,
  formatRatio,
  niceMax,
} from "./lib";

type ModeRunStats = { failed: number; elapsedS: number };

function App() {
  const { connected, ticksByMode, shield, runningMode, summaries, resetCount, cooldown } = useLive();
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [message, setMessage] = useState<string | null>(null);
  // Per-mode failed count + stopwatch, for the whole run (not just the buffered chart
  // window). Initialised from the last Summary of each mode, then live from ticks,
  // then frozen again by the "summary" message when the run ends. null = never run.
  const [modeStats, setModeStats] = useState<Record<Mode, ModeRunStats | null>>({
    without: null,
    with: null,
  });

  // Initial load + freeze on run completion.
  useEffect(() => {
    setModeStats((prev) => ({
      without: summaries.without
        ? { failed: summaries.without.failed, elapsedS: summaries.without.durationS }
        : prev.without,
      with: summaries.with
        ? { failed: summaries.with.failed, elapsedS: summaries.with.durationS }
        : prev.with,
    }));
  }, [summaries]);

  // Reset: every mode back to "never run".
  useEffect(() => {
    if (resetCount > 0) setModeStats({ without: null, with: null });
  }, [resetCount]);

  // Live update while a run is going (per mode, from that mode's own tick buffer).
  useEffect(() => {
    setModeStats((prev) => {
      let next = prev;
      for (const mode of ["without", "with"] as const) {
        const modeTicks = ticksByMode[mode];
        if (modeTicks.length === 0) continue;
        const last = modeTicks[modeTicks.length - 1];
        if (next === prev) next = { ...prev };
        next[mode] = { failed: last.totals.failed, elapsedS: last.elapsed };
      }
      return next;
    });
  }, [ticksByMode]);

  const windowWithout = useMemo(() => computeModeWindow(ticksByMode.without), [ticksByMode.without]);
  const windowWith = useMemo(() => computeModeWindow(ticksByMode.with), [ticksByMode.with]);

  // Same chart type shares one y-domain across both mode panels, so the two sides
  // are visually comparable.
  const requestsYDomain = useMemo<[number, number]>(() => {
    const values = [...windowWithout.visible, ...windowWith.visible].flatMap((b) => [
      b.requests.ok,
      b.requests.failed,
    ]);
    const rawMax = values.length > 0 ? Math.max(...values) : 0;
    // Starts at 0-5 with no data and grows with it.
    return [0, Math.max(REQUESTS_Y_MIN_MAX, niceMax(rawMax))];
  }, [windowWithout.visible, windowWith.visible]);

  const visitorsYDomain: [number, number] = [0, VISITORS_Y_MAX];

  const requestDataWithout = useMemo(
    () => windowWithout.visible.map((b) => ({ t: b.t, ok: b.requests.ok, failed: b.requests.failed })),
    [windowWithout.visible],
  );
  const requestDataWith = useMemo(
    () => windowWith.visible.map((b) => ({ t: b.t, ok: b.requests.ok, failed: b.requests.failed })),
    [windowWith.visible],
  );

  const visitorDataWithout = useMemo(
    () =>
      windowWithout.visible.map((b) => ({
        t: b.t,
        ready: b.visitors.ready,
        loading: b.visitors.loading,
        queued: b.visitors.queued,
        error: b.visitors.error,
      })),
    [windowWithout.visible],
  );
  const visitorDataWith = useMemo(
    () =>
      windowWith.visible.map((b) => ({
        t: b.t,
        ready: b.visitors.ready,
        loading: b.visitors.loading,
        queued: b.visitors.queued,
        error: b.visitors.error,
      })),
    [windowWith.visible],
  );

  // Failure rate / request count: live from run totals while that mode is running,
  // frozen from the summary once it's stopped. "—" if neither is available yet.
  function failureRateFor(mode: Mode): string {
    if (runningMode === mode) {
      const modeTicks = ticksByMode[mode];
      const last = modeTicks[modeTicks.length - 1];
      if (last) return formatPercent0(last.totals.failed, last.totals.ok + last.totals.failed);
    }
    const s = summaries[mode];
    return s ? formatPercent0(s.failed, s.requests) : "—";
  }

  // Users affected per mode: live from the tick while that mode runs, the summary's value after.
  function usersAffectedFor(mode: Mode): string {
    const ticks = ticksByMode[mode];
    const last = ticks[ticks.length - 1];
    if (runningMode === mode && last) return formatRatio(last.users.affected, last.users.started);
    const s = summaries[mode];
    return runningMode !== mode && s ? formatRatio(s.sawError, s.visitors) : "—";
  }

  // Queued (peak) per mode: live while that mode runs, the summary's value after.
  // null = the mode has never run. Without Shield always reads 0 (no waiting page).
  function queuedPeakFor(mode: Mode): number | null {
    if (modeStats[mode] === null) return null;
    const ticks = ticksByMode[mode];
    const livePeak = ticks.length > 0 ? Math.max(...ticks.map((b) => b.visitors.queued)) : 0;
    if (runningMode === mode) return livePeak;
    return summaries[mode]?.maxQueued ?? livePeak;
  }

  // Waiting visitors per mode (footer): on the waiting page right now (last tick).
  // 0 when that mode isn't running; "—" if the mode has never run.
  function waitingNowFor(mode: Mode): string {
    if (modeStats[mode] === null) return "—";
    const ticks = ticksByMode[mode];
    if (runningMode !== mode || ticks.length === 0) return "0";
    return String(ticks[ticks.length - 1].visitors.queued);
  }

  const footerWithout: FooterItem[] = [
    { label: "Failure rate", value: failureRateFor("without") },
    {
      label: "Users affected",
      value: usersAffectedFor("without"),
    },
    { label: "Waiting users", value: waitingNowFor("without") },
  ];

  const footerWith: FooterItem[] = [
    { label: "Failure rate", value: failureRateFor("with") },
    {
      label: "Users affected",
      value: usersAffectedFor("with"),
    },
    { label: "Waiting users", value: waitingNowFor("with") },
  ];

  async function startRun(mode: Mode) {
    setMessage(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, users }),
      });
      if (res.status === 409) {
        setMessage("A run is already going. Stop it first.");
      } else if (!res.ok) {
        setMessage(`Could not start the run (${res.status}).`);
      } else {
        // Reset only this mode's number/stopwatch; the other mode's last value stays.
        setModeStats((prev) => ({ ...prev, [mode]: { failed: 0, elapsedS: 0 } }));
      }
    } catch {
      setMessage("Could not reach the server.");
    }
  }

  async function stopRun() {
    setMessage(null);
    try {
      const res = await fetch("/api/runs/stop", { method: "POST" });
      if (!res.ok && res.status !== 404) {
        setMessage(`Could not stop the run (${res.status}).`);
      }
    } catch {
      setMessage("Could not reach the server.");
    }
  }

  async function resetRuns() {
    setMessage(null);
    try {
      const res = await fetch("/api/runs/reset", { method: "POST" });
      if (res.status === 409) setMessage("Stop the run before resetting.");
      else if (!res.ok) setMessage(`Could not reset (${res.status}).`);
    } catch {
      setMessage("Could not reach the server.");
    }
  }

  const running = runningMode !== null;
  // Right after a run the backend is still working off the spike; Run waits until it has recovered.
  const recovering = !running && cooldown > 0;

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="topbar-left">
          <h1>Rush Tester</h1>
          <span className={`ws-dot ${connected ? "ws-dot-live" : "ws-dot-down"}`} />
        </div>
        <div className="topbar-right">
          {message && <span className="toast">{message}</span>}
          <label className="users-field">
            <span className="field-label">Max users</span>
            <input
              type="number"
              min={1}
              max={MAX_USERS}
              value={users}
              onChange={(e) => setUsers(clampUsers(e.target.valueAsNumber))}
            />
          </label>
          <button type="button" className="btn btn-primary" disabled={running || recovering} onClick={() => startRun("without")}>
            {recovering ? `Recovering ${cooldown}s` : "▶ Run without Shield"}
          </button>
          <button type="button" className="btn btn-primary" disabled={running || recovering} onClick={() => startRun("with")}>
            {recovering ? `Recovering ${cooldown}s` : "▶ Run with Shield"}
          </button>
          <button type="button" className="btn btn-danger" disabled={!running} onClick={stopRun}>
            ■ Stop
          </button>
          <button type="button" className="btn btn-secondary" disabled={running} onClick={resetRuns}>
            ↺ Reset
          </button>
        </div>
      </header>

      <div className="panels-grid">
        <ModePanel
          mode="without"
          label={MODE_LABELS.without}
          running={runningMode === "without"}
          accent="failed"
          failedValue={modeStats.without?.failed ?? null}
          elapsedS={modeStats.without?.elapsedS ?? 0}
          queuedPeak={queuedPeakFor("without")}
          requestData={requestDataWithout}
          visitorData={visitorDataWithout}
          xDomain={windowWithout.xDomain}
          xTicks={windowWithout.xTicks}
          requestsYDomain={requestsYDomain}
          visitorsYDomain={visitorsYDomain}
          footer={footerWithout}
        />
        <ModePanel
          mode="with"
          label={MODE_LABELS.with}
          running={runningMode === "with"}
          accent="ok"
          failedValue={modeStats.with?.failed ?? null}
          elapsedS={modeStats.with?.elapsedS ?? 0}
          queuedPeak={queuedPeakFor("with")}
          requestData={requestDataWith}
          visitorData={visitorDataWith}
          xDomain={windowWith.xDomain}
          xTicks={windowWith.xTicks}
          requestsYDomain={requestsYDomain}
          visitorsYDomain={visitorsYDomain}
          footer={footerWith}
          shield={shield}
        />
      </div>

    </div>
  );
}

export default App;
