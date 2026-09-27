// Throwaway mock of tester/src/server.ts (HTTP API + WebSocket), so the
// dashboard in web/src can be built and eyeballed before the real backend
// (being written in parallel) exists. Not part of the shipped tester.
//
// Run: node mock/server.mjs   (serves :8080, matches the Vite proxy target)
// Then: npm run dev            (in tester/web/, proxies /api and /ws to :8080)

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = 8080;
const THRESHOLD = 10;
const RAMP_SECONDS = 20;
const RUN_SECONDS = 80;

/** @type {Set<import("ws").WebSocket>} */
const clients = new Set();

/** Last summary per mode, as GET /api/runs returns it. */
const summaries = { without: null, with: null };

/** @type {{ mode: "without" | "with", users: number, t: number } | null} */
let currentRun = null;

let shieldOffline = false;
let shieldTickCount = 0;

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function computeShield() {
  // Flip "Shield offline" on for a few ticks every so often, so that branch
  // of the dashboard gets exercised too.
  shieldTickCount++;
  if (shieldTickCount % 30 === 0) shieldOffline = true;
  if (shieldOffline && shieldTickCount % 30 >= 4) shieldOffline = false;
  if (shieldOffline) return null;

  if (!currentRun) {
    return { enabled: true, threshold: THRESHOLD, active: randomInt(0, 2), queued: 0 };
  }
  const admitted = currentRun.mode === "with" ? Math.min(currentRun.target, THRESHOLD) : currentRun.target;
  const queued = currentRun.mode === "with" ? Math.max(0, currentRun.target - THRESHOLD) : 0;
  return { enabled: true, threshold: THRESHOLD, active: admitted, queued };
}

function buildBucket() {
  if (!currentRun) return null;
  const { mode, users, t } = currentRun;
  const target = Math.min(users, Math.round((Math.min(t, RAMP_SECONDS) / RAMP_SECONDS) * users));
  currentRun.target = target;

  let visitors;
  let requests;
  if (mode === "without") {
    const ready = Math.round(target * 0.25);
    const loading = Math.round(target * 0.1);
    const error = Math.max(0, target - ready - loading);
    visitors = { ready, loading, queued: 0, error };
    requests = { ok: randomInt(0, 4), failed: randomInt(Math.max(0, target - 8), target + 2) };
  } else {
    const admitted = Math.min(target, THRESHOLD);
    const ready = Math.round(admitted * 0.75);
    const loading = admitted - ready;
    const queued = Math.max(0, target - admitted);
    visitors = { ready, loading, queued, error: 0 };
    requests = { ok: randomInt(admitted, admitted + 4), failed: 0 };
  }

  return { mode, t, target, visitors, requests, p95: randomInt(80, 420) };
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function endRun() {
  if (!currentRun) return;
  const { mode, users } = currentRun;
  const summary = {
    mode,
    users,
    requests: 1200,
    failed: mode === "without" ? randomInt(300, 600) : 0,
    visitors: users,
    sawError: mode === "without" ? randomInt(users / 3, users) : 0,
    wasQueued: mode === "with" ? randomInt(users / 3, users) : 0,
    gaveUp: mode === "with" ? randomInt(0, 8) : 0,
    maxQueued: mode === "with" ? Math.max(0, users - THRESHOLD) : 0,
    p95: randomInt(100, 500),
  };
  summaries[mode] = summary;
  currentRun = null;
  broadcast({ type: "summary", summary });
}

function tick() {
  if (currentRun) {
    currentRun.t += 1;
  }
  const run = buildBucket();
  const shield = computeShield();
  broadcast({ type: "tick", t: Math.floor(Date.now() / 1000), run, shield });
  if (currentRun && currentRun.t >= RUN_SECONDS) endRun();
}

setInterval(tick, 1000);

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/runs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(summaries));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runs") {
    readBody(req).then((body) => {
      if (currentRun) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "A run is already going" }));
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        // ignore, fall back to defaults
      }
      if (parsed.mode !== "with" && parsed.mode !== "without") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mode must be \"with\" or \"without\"" }));
        return;
      }
      const mode = parsed.mode;
      const users = Math.min(60, Math.max(1, Number(parsed.users) || 60));
      currentRun = { mode, users, t: -1, target: 0 };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: `mock-${Date.now()}` }));
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runs/stop") {
    if (!currentRun) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no run is going" }));
      return;
    }
    endRun();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`Mock tester server on http://localhost:${PORT} (WS at /ws)`);
});
