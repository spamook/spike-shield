// The run: ramp, virtual visitors, end. See "Run" in tester-work.md.

import { chromium } from "playwright";
import type { Metrics } from "./metrics.js";
import { visit, type VisitorOutcome } from "./visitor.js";

export const MAX_VISITORS = 60;
const MAX_STARTS_PER_TICK = 5; // at most 5 visitors per 100ms
const TICK_MS = 100;

export interface RunOptions {
  url: string;
  users: number;
  rampMs: number;
  metrics: Metrics;
  onTick?: (info: TickInfo) => void;
  /**
   * After the ramp, the run holds its target indefinitely - the only way it ends
   * is this signal aborting (POST /api/runs/stop, or a caller's own safety timeout).
   */
  externalStop?: AbortSignal;
  /**
   * From this point on, start no new visitors and let the running ones finish, so
   * no Supabase request is still in flight when the run is cut off.
   */
  drainAfterMs?: number;
}

export interface TickInfo {
  elapsedMs: number;
  target: number;
  active: number;
  totalVisitors: number;
}

export interface RunResult {
  outcomes: VisitorOutcome[];
  totalVisitors: number;
}

export async function runRun(opts: RunOptions): Promise<RunResult> {
  const target = Math.max(0, Math.min(Math.floor(opts.users), MAX_VISITORS));

  const browser = await chromium.launch();
  const stop = new AbortController();
  const active = new Map<string, Promise<void>>();
  const outcomes: VisitorOutcome[] = [];

  let nextId = 0;
  let totalVisitors = 0;
  let ended = false;
  const startedAt = performance.now();

  function endEarly() {
    if (ended) return;
    ended = true;
    stop.abort();
  }
  if (opts.externalStop) {
    if (opts.externalStop.aborted) endEarly();
    else opts.externalStop.addEventListener("abort", endEarly, { once: true });
  }

  function desiredConcurrency(elapsed: number): number {
    if (ended) return 0;
    if (opts.drainAfterMs !== undefined && elapsed >= opts.drainAfterMs) return 0;
    if (elapsed < opts.rampMs) {
      return opts.rampMs === 0 ? target : Math.min(target, Math.ceil((target * elapsed) / opts.rampMs));
    }
    return target;
  }

  function launchVisitor() {
    const id = `t${nextId++}`;
    totalVisitors++;
    const p = visit(browser, opts.url, opts.metrics, stop.signal)
      .catch(
        (): VisitorOutcome => ({ queued: false, gaveUp: false, error: true, timeout: false }), // crashed visitor counts as an error
      )
      .then((outcome) => {
        outcomes.push(outcome);
        active.delete(id);
      });
    active.set(id, p);
  }

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt;

      if (!ended) {
        let startedThisTick = 0;
        const desired = desiredConcurrency(elapsed);
        while (active.size < desired && startedThisTick < MAX_STARTS_PER_TICK) {
          launchVisitor();
          startedThisTick++;
        }
      }

      opts.onTick?.({ elapsedMs: elapsed, target: desiredConcurrency(elapsed), active: active.size, totalVisitors });

      if (ended && active.size === 0) {
        clearInterval(timer);
        browser.close().then(() => resolve({ outcomes, totalVisitors }));
      }
    }, TICK_MS);
  });
}
