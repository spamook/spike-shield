// Shared constants and small pure helpers for the dashboard UI.
import type { Mode, PageState, RunTick } from "./types";

// Input limit only; the server still caps concurrent visitors at MAX_VISITORS (60).
export const MAX_USERS = 99;
// Visitors by state y-axis is fixed so both panels and all runs read the same scale.
export const VISITORS_Y_MAX = 100;
// Requests/s y-axis top when there is no data yet; it grows with the data from there.
export const REQUESTS_Y_MIN_MAX = 5;

/** Five even integer steps from 0 to max (max comes from niceMax, so it divides cleanly). */
export function yTicks([min, max]: [number, number]): number[] {
  const step = (max - min) / 5;
  return Array.from({ length: 6 }, (_, i) => min + i * step);
}
export const DEFAULT_USERS = 60;

// Fixed 60s window for the two live charts: 0-60s while idle or early in a run,
// then a sliding last-60s window once a run passes 60s. Ticks every 10s.
export const CHART_WINDOW_S = 60;
export const TICK_STEP_S = 10;

export const MODES: Mode[] = ["without", "with"];

export const MODE_LABELS: Record<Mode, string> = {
  without: "Without Shield",
  with: "With Shield",
};

export const STATE_ORDER: PageState[] = ["ready", "loading", "queued", "error"];

export const STATE_LABELS: Record<PageState, string> = {
  ready: "Ready",
  loading: "Loading",
  queued: "Queued",
  error: "Error",
};

export const STATE_COLORS: Record<PageState, string> = {
  ready: "var(--ok)",
  loading: "var(--loading)",
  queued: "var(--queued)",
  error: "var(--failed)",
};

export function clampUsers(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_USERS;
  return Math.min(MAX_USERS, Math.max(1, Math.round(n)));
}

// mm:ss, floors fractional seconds.
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Whole-percent failure rate, "—" when there's no denominator yet.
export function formatPercent0(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

export function formatRatio(part: number, total: number): string {
  return `${part} / ${total}`;
}

/**
 * Round a raw max up to a visually "nice" number (1/2/2.5/5/10 * 10^n) with a
 * little headroom, min 0. Empty/degenerate input falls back to a small domain
 * so charts never show NaN.
 */
export function niceMax(rawMax: number): number {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return 1;
  const withHeadroom = rawMax * 1.1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(withHeadroom)));
  const residual = withHeadroom / magnitude;
  let niceResidual: number;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 2.5) niceResidual = 2.5;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}

export type ModeWindow = {
  visible: RunTick[];
  xDomain: [number, number];
  xTicks: number[];
};

/** Per-mode fixed 60s window: [0, 60] while idle/early, sliding once past 60s. */
export function computeModeWindow(ticks: RunTick[]): ModeWindow {
  const windowMax = ticks.length > 0 ? Math.max(CHART_WINDOW_S, ticks[ticks.length - 1].t) : CHART_WINDOW_S;
  const windowMin = windowMax - CHART_WINDOW_S;
  const xDomain: [number, number] = [windowMin, windowMax];
  // Ticks on round multiples of TICK_STEP_S, so a sliding window reads 30, 40, ... not 28, 38, ...
  const firstTick = Math.ceil(windowMin / TICK_STEP_S) * TICK_STEP_S;
  const xTicks: number[] = [];
  for (let x = firstTick; x <= windowMax; x += TICK_STEP_S) xTicks.push(x);
  const visible = ticks.filter((b) => b.t >= windowMin);
  return { visible, xDomain, xTicks };
}
