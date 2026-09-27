// Express app, routes, static files, WebSocket. See "HTTP API and WebSocket" in
// tester-work.md and "Setup" in team-plan.md for ports.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { WebSocket, WebSocketServer } from "ws";

import { buildSummary, createMetrics, type RunMetrics, type Summary } from "./metrics.js";
import { MAX_VISITORS, runRun } from "./runner.js";
import { fetchShieldStats } from "./shield.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8080);
const TARGET_WITHOUT = process.env.TARGET_WITHOUT ?? "http://localhost:4173";
const TARGET_WITH = process.env.TARGET_WITH ?? "http://localhost:4174";
const RAMP_S = Number(process.env.RAMP_S ?? 20);
// After the ramp, a run holds its target until POST /api/runs/stop. MAX_RUN_S is a
// safety net: the whole run (ramp + hold) auto-stops after this many seconds.
const MAX_RUN_S = Number(process.env.MAX_RUN_S ?? 300);
// The last DRAIN_S seconds start no new visitors: a visitor waits up to 20 s in the
// queue and requests right after it gets in, so 30 s lets the last requests finish.
const DRAIN_S = Number(process.env.DRAIN_S ?? 30);

const RUNS_FILE = path.join(__dirname, "..", "runs.json");
const WEB_DIST = path.join(__dirname, "..", "web", "dist");

type Mode = "without" | "with";

interface ActiveRun {
  id: string;
  mode: Mode;
  users: number;
  metrics: RunMetrics;
  startedAt: number;
  target: number;
  /** Visitors started so far in this run. */
  started: number;
  /** Elapsed ms when stop was requested; the stopwatch freezes here while visitors close. */
  stoppedAtMs: () => number | null;
  /** Ends the run now (manual stop or the MAX_RUN_S safety timeout), idempotent. */
  requestStop: () => void;
}

let currentRun: ActiveRun | null = null;
let lastSummaries: Record<Mode, Summary | null> = { without: null, with: null };

function loadRuns() {
  try {
    const raw = fs.readFileSync(RUNS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    lastSummaries = { without: parsed.without ?? null, with: parsed.with ?? null };
  } catch {
    // no runs.json yet, or unreadable: start fresh
    lastSummaries = { without: null, with: null };
  }
}

function saveRuns() {
  fs.writeFileSync(RUNS_FILE, JSON.stringify(lastSummaries, null, 2));
}

loadRuns();

const app = express();
app.use(express.json());

app.post("/api/runs", (req, res) => {
  const { mode: rawMode, users } = req.body ?? {};
  if (rawMode !== "without" && rawMode !== "with") {
    res.status(400).json({ error: "mode must be 'without' or 'with'" });
    return;
  }
  const mode: Mode = rawMode;
  if (currentRun) {
    res.status(409).json({ error: "a run is already in progress" });
    return;
  }

  const cappedUsers = Math.max(0, Math.min(Math.floor(Number(users) || 0), MAX_VISITORS));
  const id = randomUUID();
  const url = mode === "without" ? TARGET_WITHOUT : TARGET_WITH;
  const metrics = createMetrics();
  const abort = new AbortController();
  const startedAt = performance.now();
  let stoppedAtMs: number | null = null;

  function requestStop() {
    if (stoppedAtMs === null) stoppedAtMs = performance.now() - startedAt;
    abort.abort();
  }

  currentRun = { id, mode, users: cappedUsers, metrics, startedAt, target: 0, started: 0, stoppedAtMs: () => stoppedAtMs, requestStop };

  const maxRunTimer = setTimeout(requestStop, MAX_RUN_S * 1000);

  runRun({
    url,
    users: cappedUsers,
    rampMs: RAMP_S * 1000,
    metrics,
    externalStop: abort.signal,
    drainAfterMs: Math.max(0, MAX_RUN_S - DRAIN_S) * 1000,
    onTick(info) {
      if (currentRun?.id === id) {
        currentRun.target = info.target;
        currentRun.started = info.totalVisitors;
      }
    },
  })
    .then((result) => {
      const durationS = Math.floor((stoppedAtMs ?? (performance.now() - startedAt)) / 1000);
      const summary = buildSummary(metrics, mode, cappedUsers, result.outcomes, result.totalVisitors, durationS);
      lastSummaries[mode] = summary;
      saveRuns();
      broadcast({ type: "summary", summary });
    })
    .catch((err) => {
      console.error("run failed:", err);
    })
    .finally(() => {
      clearTimeout(maxRunTimer);
      if (currentRun?.id === id) currentRun = null;
    });

  res.json({ id });
});

app.post("/api/runs/stop", (_req, res) => {
  if (!currentRun) {
    res.status(404).json({ error: "no run in progress" });
    return;
  }
  currentRun.requestStop();
  res.json({ ok: true });
});

// Clears the saved summaries so the dashboard starts from "–" again (not during a run).
app.post("/api/runs/reset", (_req, res) => {
  if (currentRun) {
    res.status(409).json({ error: "a run is in progress" });
    return;
  }
  lastSummaries = { without: null, with: null };
  saveRuns();
  broadcast({ type: "reset" });
  res.json({ ok: true });
});

app.get("/api/runs", (_req, res) => {
  res.json(lastSummaries);
});

app.use(express.static(WEB_DIST));

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

// One tick per second, always - whether or not a run is going.
let idleT = 0;
setInterval(() => {
  void (async () => {
    const shield = await fetchShieldStats();
    if (currentRun) {
      const t = Math.floor((performance.now() - currentRun.startedAt) / 1000);
      const bucket = currentRun.metrics.tick(t, currentRun.target);
      const totals = currentRun.metrics.totals();
      const stoppedAt = currentRun.stoppedAtMs();
      const elapsed = stoppedAt === null ? t : Math.floor(stoppedAt / 1000);
      broadcast({ type: "tick", t, run: {
          mode: currentRun.mode,
          ...bucket,
          elapsed,
          totals,
          users: { started: currentRun.started, affected: currentRun.metrics.usersAffected() },
        }, shield });
    } else {
      broadcast({ type: "tick", t: idleT++, run: null, shield });
    }
  })();
}, 1000);

httpServer.listen(PORT, () => {
  console.log(`tester listening on http://localhost:${PORT}`);
  console.log(`  without -> ${TARGET_WITHOUT}   with -> ${TARGET_WITH}   ramp=${RAMP_S}s max=${MAX_RUN_S}s`);
});
