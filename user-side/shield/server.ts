// Spike Shield service for the demo: one Node process on localhost:8090.
// Stands in for our CDN (serves shield.js) and the hosted admit service + waitlist. All state is
// in memory; a restart clears it. Run with `npm start` (tsx, no build step).
//
//   GET  /shield.js                 Fake App          static file from public/
//   POST /shield/admit              shield.js, replay { siteId, sessionId } -> { status, position? }
//   POST /shield/waitlist           shield.js         { siteId, sessionId, email } -> 204
//   PUT  /shield/config             Tester Backend    { siteId, enabled, threshold } -> 204
//   GET  /shield/stats?siteId=...   Tester Backend    { enabled, threshold, active, queued, emails, notices }
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admit, configure, saveEmail, stats } from "./admit.ts";

const PORT = Number(process.env.PORT ?? 8090);
const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// CORS on all routes: the Fake App runs on :4173 and the Backend on :8080.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(here, "public")));

app.post("/shield/admit", (req, res) => {
  const { siteId, sessionId } = req.body ?? {};
  if (typeof siteId !== "string" || typeof sessionId !== "string") {
    return res.status(400).json({ error: "siteId and sessionId required" });
  }
  res.json(admit(siteId, sessionId));
});

app.post("/shield/waitlist", (req, res) => {
  const { siteId, sessionId, email } = req.body ?? {};
  if (typeof siteId !== "string" || typeof sessionId !== "string" || typeof email !== "string") {
    return res.status(400).json({ error: "siteId, sessionId and email required" });
  }
  saveEmail(siteId, sessionId, email);
  res.sendStatus(204);
});

app.put("/shield/config", (req, res) => {
  const { siteId, enabled, threshold } = req.body ?? {};
  if (typeof siteId !== "string" || typeof enabled !== "boolean" || !Number.isInteger(threshold) || threshold < 0) {
    return res.status(400).json({ error: "siteId (string), enabled (boolean), threshold (integer) required" });
  }
  configure(siteId, enabled, threshold);
  res.sendStatus(204);
});

app.get("/shield/stats", (req, res) => {
  const siteId = req.query.siteId;
  if (typeof siteId !== "string") return res.status(400).json({ error: "siteId query required" });
  res.json(stats(siteId));
});

app.listen(PORT, () => {
  console.log(`Spike Shield service on http://localhost:${PORT} (shield.js, admit, waitlist, config, stats)`);
});
