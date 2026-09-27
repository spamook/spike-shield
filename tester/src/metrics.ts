// Per-second buckets and the run summary. See "Metrics" in tester-work.md.
//
// Keeps the same Metrics surface the placeholder had (request/state), so
// visitor.ts and runner.ts need no changes: request(status, ms), state(id, state|null).

import type { VisitorOutcome } from "./visitor.js";

export type PageState = "loading" | "queued" | "ready" | "error";

export interface Metrics {
  /** Record one Supabase request outcome. status 0 = connection error / timeout / still pending. */
  request(status: number, ms: number): void;
  /** Record a visitor's current page state. state === null means the visitor ended (stop counting it). */
  state(id: string, state: PageState | null): void;
  /** The visitor couldn't use the app (error or timeout). Counted once per visitor, live. */
  affected(id: string): void;
}

export interface MetricsSnapshot {
  requestsOk: number;
  requestsFailed: number;
  latencies: number[];
  /** Visitors currently in each state (concurrent, not cumulative). */
  visitors: Record<PageState, number>;
}

// Exact shapes from tester-work.md's "Metrics" section.
export type Bucket = {
  t: number; // seconds since the run started
  target: number;
  visitors: { loading: number; queued: number; ready: number; error: number };
  requests: { ok: number; failed: number };
  p95: number; // Supabase latency, ms
};

export type Summary = {
  mode: "without" | "with";
  users: number;
  requests: number;
  failed: number; // failed / requests = failure rate
  visitors: number; // all visitors started in the run
  sawError: number; // ended in error or timeout
  wasQueued: number; // saw the waiting page at least once
  gaveUp: number; // left the waiting page without getting in
  maxQueued: number;
  p95: number;
  durationS: number; // seconds from Run to Stop/auto-stop (frozen stopwatch value)
};

export interface RunMetrics extends Metrics {
  /** Cumulative snapshot since the run started (used by scale.ts's console printout). */
  snapshot(): MetricsSnapshot;
  /**
   * Build the Bucket for the second that just elapsed (t, target), using
   * requests/latencies seen since the previous tick(), then reset that window.
   * Visitor counts in the bucket are the live (concurrent) counts at call time.
   */
  tick(t: number, target: number): Bucket;
  /** Highest concurrent "queued" count seen across all tick() calls so far. */
  maxQueued(): number;
  /** Cumulative ok/failed request counts since the run started (never resets). */
  totals(): { ok: number; failed: number };
  /** Visitors marked affected so far (the live "Users affected" count). */
  usersAffected(): number;
}

export function createMetrics(): RunMetrics {
  // Cumulative, for the whole run.
  let requestsOk = 0;
  let requestsFailed = 0;
  const latencies: number[] = [];
  const byVisitor = new Map<string, PageState>();

  // Reset every tick(), for the per-second Bucket.
  let windowOk = 0;
  let windowFailed = 0;
  let windowLatencies: number[] = [];

  let maxQueuedSeen = 0;
  const affectedIds = new Set<string>();

  function liveVisitorCounts(): Record<PageState, number> {
    const v: Record<PageState, number> = { loading: 0, queued: 0, ready: 0, error: 0 };
    for (const s of byVisitor.values()) v[s]++;
    return v;
  }

  return {
    request(status, ms) {
      const ok = status >= 200 && status < 300;
      if (ok) {
        requestsOk++;
        windowOk++;
      } else {
        requestsFailed++;
        windowFailed++;
      }
      latencies.push(ms);
      windowLatencies.push(ms);
    },
    state(id, s) {
      if (s === null) byVisitor.delete(id);
      else byVisitor.set(id, s);
    },
    affected(id) {
      affectedIds.add(id);
    },
    usersAffected() {
      return affectedIds.size;
    },
    snapshot() {
      return {
        requestsOk,
        requestsFailed,
        latencies: [...latencies],
        visitors: liveVisitorCounts(),
      };
    },
    tick(t, target) {
      const visitors = liveVisitorCounts();
      maxQueuedSeen = Math.max(maxQueuedSeen, visitors.queued);
      const bucket: Bucket = {
        t,
        target,
        visitors,
        requests: { ok: windowOk, failed: windowFailed },
        p95: p95(windowLatencies),
      };
      windowOk = 0;
      windowFailed = 0;
      windowLatencies = [];
      return bucket;
    },
    maxQueued() {
      return maxQueuedSeen;
    },
    totals() {
      return { ok: requestsOk, failed: requestsFailed };
    },
  };
}

export function p95(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[idx]);
}

/** Build the final run Summary from cumulative metrics plus each visitor's outcome. */
export function buildSummary(
  m: RunMetrics,
  mode: "without" | "with",
  users: number,
  outcomes: VisitorOutcome[],
  totalVisitors: number,
  durationS: number,
): Summary {
  const snap = m.snapshot();
  return {
    mode,
    users,
    requests: snap.requestsOk + snap.requestsFailed,
    failed: snap.requestsFailed,
    visitors: totalVisitors,
    sawError: outcomes.filter((o) => o.error || o.timeout).length,
    wasQueued: outcomes.filter((o) => o.queued).length,
    gaveUp: outcomes.filter((o) => o.gaveUp).length,
    maxQueued: m.maxQueued(),
    p95: p95(snap.latencies),
    durationS,
  };
}
