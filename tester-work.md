# Tester Side: Rush Tester

Work spec for the Tester side (`tester/`). See [team-plan.md](team-plan.md) for roles, ports and the contract, [fakeapp-scripts-work.md](fakeapp-scripts-work.md) for the Target side, and [spike-shield.md](spike-shield.md) for the product.

## Goal

A rush tester built only for the Fake App, to show the Shield working. It is not part of the product.

- Real browsers (Playwright) visit the Fake App like a spike of real visitors. They load the page, so they run `shield.js` and get queued like real visitors would. Plain HTTP requests would skip the script.
- Its dashboard shows the two runs:
  - Without the Shield (`:4173`): many failed requests.
  - With the Shield (`:4174`): no failed requests, and part of the visitors wait in the queue.

One Node process on `localhost:8080`: the runner, an HTTP API, a WebSocket, and the dashboard.

There is no tester flag in `shield.js`: virtual visitors get exactly what real visitors get. In the demo we also open `:4174` in our own browser during the second run, wait on the waiting page and get in. Virtual visitors leave the line often enough (see Virtual visitor) that this takes about 20–30 seconds.

## Stack

- Node 20+, TypeScript run with `tsx` (no build step)
- Playwright (Chromium only)
- Express for HTTP, `ws` for the WebSocket
- Frontend: Vite + React + TypeScript in `web/`, Recharts for charts
- No database. Run summaries are kept in memory and written to `runs.json`, so a reload keeps them.

```bash
cd tester
npm init -y
npm install express ws playwright
npm install -D tsx typescript @types/express @types/ws
npx playwright install chromium

npm create vite@latest web -- --template react-ts
cd web && npm install recharts
```

- `package.json`: `"start": "npm --prefix web run build && tsx src/server.ts"`. Express serves `web/dist`.
- While building the frontend: `npm run dev` in `web/` (port 5173), with a Vite proxy for `/api` and `/ws` to 8080.

## Folders

```
tester/
├─ src/
│  ├─ server.ts       # Express app, routes, static files, WebSocket
│  ├─ runner.ts       # the run: ramp, virtual visitors, end
│  ├─ visitor.ts      # one virtual visitor in its own browser context
│  ├─ metrics.ts      # per-second buckets and the run summary
│  └─ shield.ts       # polls the Shield stats
└─ web/src/
   ├─ useLive.ts      # WebSocket hook
   └─ App.tsx         # the one dashboard page
```

## Run

A run has a mode and a number of visitors.

| Mode | URL |
|---|---|
| `without` | `http://localhost:4173` |
| `with` | `http://localhost:4174` |

1. Ramp: raise the target from 0 to `users` (default 60) over 20 seconds.
2. Hold: keep the target for 60 seconds. When a visitor ends, a new one starts in its place, so a steady target is a steady stream of new visitors.
3. End: stop starting visitors, close all contexts, write the summary.

- Start at most 5 visitors per 100 ms, so the browser isn't flooded.
- One run at a time. Starting a second one returns `409`.
- Hard limit: `MAX_VISITORS = 60`. The runner never starts more, whatever the dashboard sends.
- Scale test step by step (10 → 20 → 40 → 60) with Task Manager open. CPU fills up before memory (32 GB is enough), so check that the dashboard and our own browser stay smooth.

## Virtual visitor

Each visitor gets its own browser context, so it has its own `localStorage` and so its own Shield session id.

1. Open the page.
2. Watch the page state every 500 ms (contract in team-plan):
   - `#spike-shield` exists → `queued`
   - `body[data-state]` is `loading`, `ready` or `error`
3. Stay 30 seconds after the state first becomes `ready` or `error` (the visitor reading the page), then close.
4. On the waiting page, like real visitors:
   - 50%: leave at once (stands in for "left an email and went away").
   - 50%: wait. `shield.js` lets them in when a slot frees up, and then step 3 applies. Not admitted within 20 seconds → give up and leave.
   - Either way the visitor counts as "sent to the waiting page". Its app code never runs, so it never hits Supabase. Virtual visitors never type an email.
5. Close: go to `about:blank` first, so `pagehide` fires and `shield.js` sends "leave". Without it the Shield keeps the session for 30 seconds, and people behind it wait longer.
6. Not `ready` within 15 seconds of leaving the queue (or of opening the page, without the Shield) → counted as `timeout`.

```ts
// src/visitor.ts (core)
const SUPABASE = "http://localhost:54321";

export async function visit(browser: Browser, url: string, m: Metrics, stop: AbortSignal) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route("**/*.{png,jpg,jpeg,svg,woff,woff2}", (r) => r.abort());   // save CPU

  const started = new Map<Request, number>();
  page.on("request", (r) => { if (r.url().startsWith(SUPABASE)) started.set(r, performance.now()); });
  page.on("requestfinished", async (r) => {
    const t0 = started.get(r); if (t0 === undefined) return;
    started.delete(r);
    const res = await r.response();
    m.request(res?.status() ?? 0, performance.now() - t0);
  });
  page.on("requestfailed", (r) => {
    const t0 = started.get(r); if (t0 === undefined) return;
    started.delete(r);
    m.request(0, performance.now() - t0);
  });

  try {
    await page.goto(url, { timeout: 15_000 });
    // poll the state, update m.state(...), stay or leave as described above
  } finally {
    await page.goto("about:blank").catch(() => {});   // fires pagehide → shield.js sends leave
    for (const t0 of started.values()) m.request(0, performance.now() - t0);   // still pending = failed
    await ctx.close();
  }
}
```

- Only requests to Supabase count. The page, `shield.js` and admit calls are not the app's database.
- A failed request is status 0 (connection error, timeout, still pending at the end) or 5xx.
- A Supabase request with no answer after 10 seconds counts as failed. The browser would wait longer, but a real visitor has already left.

## Metrics

One bucket per second:

```ts
type Bucket = {
  t: number;                       // seconds since the run started
  target: number;
  visitors: { loading: number; queued: number; ready: number; error: number };
  requests: { ok: number; failed: number };
  p95: number;                     // Supabase latency, ms
};
```

Run summary:

```ts
type Summary = {
  mode: "without" | "with";
  users: number;
  requests: number; failed: number;          // failed / requests = failure rate
  visitors: number;                          // all visitors started in the run
  sawError: number;                          // ended in error or timeout
  wasQueued: number;                         // saw the waiting page at least once
  gaveUp: number;                            // left the waiting page without getting in
  maxQueued: number;
  p95: number;
};
```

## HTTP API and WebSocket

| Method | Path | What |
|---|---|---|
| POST | `/api/runs` | Start a run: `{ "mode": "without", "users": 60 }` → `{ "id": "..." }`, `409` if one runs |
| POST | `/api/runs/stop` | End the run now |
| GET | `/api/runs` | Last summary per mode |
| WS | `/ws` | Live data |

WebSocket messages, server to browser:

```ts
// every second, also when no run is going
{ type: "tick", t: number, run: null | ({ mode: "without" | "with" } & Bucket), shield: ShieldStats | null }

// when a run ends
{ type: "summary", summary: Summary }
```

`shield.ts` polls `GET http://localhost:8090/shield/stats?siteId=idea-roaster` every second (timeout 500 ms, `null` if the Shield service is down).

## Dashboard

One page at `localhost:8080`, readable from the back of the room: big numbers, few words.

- Controls: visitors input (default 60), buttons "Run without Shield", "Run with Shield", "Stop".
- Live, during a run:
  - Big number: failed requests, red when above 0.
  - Chart of the last 2 minutes: ok and failed requests per second.
  - Chart of the last 2 minutes: visitors stacked by state (ready, loading, queued, error).
- Shield card, from the stats: active against the threshold, and queued.
- Comparison: the last summary of each mode side by side. Failure rate, visitors who saw an error, visitors queued. This is the last screen of the demo.

## Build order

Each step is testable alone.

1. Scale test first. `runner.ts` and `visitor.ts` with a fixed number of visitors, results in the console. Run it against the Fake App (or any local page) on the demo laptop, with Supabase running, and find how many visitors the laptop handles. Tell the Target side the number: it must be at least 60, twice the breaking point (20–30). If it is lower, the Target side tightens the caps.
2. Metrics, the API and the WebSocket.
3. The dashboard.
4. Run both modes against the real Fake App and the Shield, and tune `users` with the Target side.

If the laptop runs too few browsers, lower `users` and tighten the Supabase caps rather than dropping Playwright.

## Checklist

1. The laptop runs the default number of visitors next to Supabase without the tester itself stalling
2. "Without Shield" gives a clear number of failed requests at the same `users`, run after run
3. "With Shield" gives 0 failed requests, with queued visitors and active visitors flat at the threshold
4. Our own browser on `:4174` shows the waiting page during the second run and gets in within about 20–30 seconds
5. The comparison shows both runs side by side
6. Full demo run on this laptop, with `start.sh` and `npm start` from a fresh clone
