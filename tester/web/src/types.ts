// Message and data shapes shared with the tester backend (tester/src/server.ts).
// Source: tester-work.md "Metrics" and "HTTP API and WebSocket".

export type Mode = "without" | "with";

export type PageState = "loading" | "queued" | "ready" | "error";

export type Bucket = {
  t: number; // seconds since the run started
  target: number;
  visitors: Record<PageState, number>;
  requests: { ok: number; failed: number };
  p95: number; // Supabase latency, ms
};

// A tick's "run" field: the current bucket plus which mode produced it, cumulative
// run totals (survive the 60s chart window / tick buffer), and elapsed run time.
export type RunTick = Bucket & {
  mode: Mode;
  elapsed: number; // seconds since this run started (server time)
  totals: { ok: number; failed: number }; // cumulative since the run started
  users: { started: number; affected: number }; // live "Users affected": affected / started
};

// GET /shield/stats shape (team-plan.md "Contract between the two sides", item 8).
export type ShieldStats = {
  enabled: boolean;
  threshold: number;
  active: number;
  queued: number;
};

export type Summary = {
  mode: Mode;
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

// Last summary per mode, as returned by GET /api/runs.
export type Summaries = { without: Summary | null; with: Summary | null };

export type TickMessage = {
  type: "tick";
  t: number;
  run: RunTick | null;
  shield: ShieldStats | null;
  cooldown: number; // seconds until a new run may start (backend recovering), 0 = ready
};

export type SummaryMessage = {
  type: "summary";
  summary: Summary;
};

// Saved summaries were cleared (POST /api/runs/reset): start every panel from scratch.
export type ResetMessage = { type: "reset" };

export type ServerMessage = TickMessage | SummaryMessage | ResetMessage;
