import { useEffect, useRef, useState } from "react";
import type { Mode, RunTick, ServerMessage, ShieldStats, Summaries } from "./types";

// One run can hold for up to MAX_RUN_S (300s server default) plus the ramp; keep enough
// buffer per mode to cover a full run at 1 tick/s with margin.
const MAX_TICKS_PER_MODE = 360;
const RECONNECT_DELAY_MS = 1000;

export type TickBuffers = Record<Mode, RunTick[]>;

export type LiveState = {
  connected: boolean;
  /** Per-mode run buckets. Starting a run of a mode (t === 0) clears only that mode's buffer. */
  ticksByMode: TickBuffers;
  /** null when the Shield service is down or unreachable. */
  shield: ShieldStats | null;
  /** Mode of the run currently going, null when idle. */
  runningMode: Mode | null;
  /** Last summary per mode, from the initial GET and each "summary" message. */
  summaries: Summaries;
  /** Increments on each server reset. */
  resetCount: number;
  /** Seconds until Run is allowed again after a run (backend recovering). */
  cooldown: number;
};

const EMPTY_BUFFERS: TickBuffers = { without: [], with: [] };

export function useLive(): LiveState {
  const [connected, setConnected] = useState(false);
  const [ticksByMode, setTicksByMode] = useState<TickBuffers>(EMPTY_BUFFERS);
  const [shield, setShield] = useState<ShieldStats | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [runningMode, setRunningMode] = useState<Mode | null>(null);
  const [summaries, setSummaries] = useState<Summaries>({ without: null, with: null });
  // Bumped on each "reset" message, so the page can clear its own per-mode state too.
  const [resetCount, setResetCount] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetch("/api/runs")
      .then((res) => (res.ok ? (res.json() as Promise<Summaries>) : null))
      .then((data) => {
        if (mountedRef.current && data) setSummaries(data);
      })
      .catch(() => {});
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    // Mode of the previous tick's run (null when idle), to detect a new run starting.
    let prevRunMode: Mode | null = null;

    const connect = () => {
      if (stopped) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${proto}//${window.location.host}/ws`);

      socket.onopen = () => setConnected(true);

      socket.onclose = () => {
        setConnected(false);
        if (!stopped) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        if (msg.type === "tick") {
          setShield(msg.shield);
          setCooldown(msg.cooldown ?? 0);
          setRunningMode(msg.run?.mode ?? null);
          const newRun = msg.run !== null && msg.run.mode !== prevRunMode;
          prevRunMode = msg.run?.mode ?? null;
          if (msg.run) {
            const run = msg.run;
            setTicksByMode((prev) => {
              // A new run starts when the previous tick was idle or another mode. The first
              // tick can be t=1, not t=0, so t alone can't tell. Also reset if t goes back.
              const last = prev[run.mode][prev[run.mode].length - 1];
              const reset = newRun || !last || run.t <= last.t;
              const modeTicks = reset ? [run] : [...prev[run.mode], run];
              const trimmed =
                modeTicks.length > MAX_TICKS_PER_MODE
                  ? modeTicks.slice(modeTicks.length - MAX_TICKS_PER_MODE)
                  : modeTicks;
              return { ...prev, [run.mode]: trimmed };
            });
          }
        } else if (msg.type === "summary") {
          const summary = msg.summary;
          setSummaries((prev) => ({ ...prev, [summary.mode]: summary }));
        } else if (msg.type === "reset") {
          setTicksByMode(EMPTY_BUFFERS);
          setSummaries({ without: null, with: null });
          setResetCount((c) => c + 1);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { connected, ticksByMode, shield, runningMode, summaries, resetCount, cooldown };
}
