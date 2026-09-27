// Throwaway local stub for testing visitor.ts/runner.ts before the real Fake App
// and Supabase exist. Serves the stub page(s) on PAGE_PORT and a Supabase-like
// REST endpoint on SUPABASE_PORT (54321 by default, matching the real contract).
//
// No Shield stub here: the tester dashboard's Shield card must only ever reflect
// the real Shield service on :8090 (see src/shield.ts). Without it running, the
// dashboard shows "Shield offline", which is correct.
//
//   node temp/server.mjs
//   npx tsx src/scale.ts --url "http://localhost:4180/?mode=ready" --users 3 --ramp 5 --hold 10
//   npx tsx src/scale.ts --url "http://localhost:4180/queue.html?admitAfter=3000" --users 3 --ramp 5 --hold 10

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PORT = Number(process.env.PAGE_PORT || 4180);
const SUPABASE_PORT = Number(process.env.SUPABASE_PORT || 54321);

const pages = {
  "/": "index.html",
  "/index.html": "index.html",
  "/queue": "queue.html",
  "/queue.html": "queue.html",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const file = pages[url.pathname];
    if (!file) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const body = fs.readFileSync(path.join(__dirname, file));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
  })
  .listen(PAGE_PORT, () => console.log(`[stub-page] http://localhost:${PAGE_PORT}`));

// Mocks a Supabase-like REST endpoint so visitor.ts's request counting can be tested.
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const mode = url.searchParams.get("mode") || "ready";
    const delay = Number(url.searchParams.get("delay") || "300");

    const cors = { "Access-Control-Allow-Origin": "*" };
    const send = () => {
      if (mode === "error") {
        res.writeHead(500, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "boom" }));
      } else if (mode === "timeout") {
        // never respond: exercises the "no answer after 10s = failed" rule
        return;
      } else {
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify([{ id: 1, title: "Idea #1" }]));
      }
    };
    if (mode === "timeout") return send();
    setTimeout(send, delay);
  })
  .listen(SUPABASE_PORT, () => console.log(`[stub-supabase] http://localhost:${SUPABASE_PORT}`));
