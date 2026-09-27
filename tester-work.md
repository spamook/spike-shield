# Tester Side: Check, Load, Dashboard

Work spec for the Tester side (`service-side/`). See [team-plan.md](team-plan.md) for roles, ports and the API contract, [fakeapp-scripts-work.md](fakeapp-scripts-work.md) for the Target side, and [spike-shield.md](spike-shield.md) for the product.

## Goal

One Node process on `localhost:8080` that stands in for the Spike Shield cloud, except the Shield service (`user-side/shield/`, port 8090, built by the Target side):

- The check: analyze, replay, diagnose. It spike-tests the customer's service: virtual visitors do what real visitors' browsers do, and we find how many people at the same time it takes to break the app.
- The load engine: virtual users whose number can be changed while they run.
- The dashboard for the builder (our customer), and a demo panel for us.
- The link to the Shield service: sends the Shield config and polls its stats for the dashboard.

No login. There is one site, `idea-roaster`, and anyone who opens `localhost:8080` sees it.

No Playwright in the demo. The journey (the calls one visitor makes) is hand-written from the Fake App.

## Stack

- Node 20+, TypeScript run with `tsx` (no build step)
- Express for HTTP, `ws` for the WebSocket
- `undici` for the load (fast HTTP client with a connection pool)
- `better-sqlite3` for check results. If it fails to install on Windows, save JSON files instead.
- Frontend: Vite + React + TypeScript in `web/`, Recharts for charts, live data over the WebSocket.

```bash
cd service-side
npm init -y
npm install express ws undici better-sqlite3
npm install -D tsx typescript @types/express @types/ws @types/better-sqlite3

npm create vite@latest web -- --template react-ts
cd web && npm install recharts react-router-dom
```

- `package.json`: `"start": "npm --prefix web run build && tsx src/server.ts"`. Express serves `web/dist`, so the demo still runs as one process on 8080.
- While building the frontend: `npm run dev` in `web/` (port 5173), with a Vite proxy for `/api` and `/ws` to 8080.

## Folders

```
service-side/
├─ src/
│  ├─ server.ts            # Express app, routes, static files, WebSocket
│  ├─ live.ts              # WebSocket: pushes a tick every second
│  ├─ shield.ts            # client for the Shield service: config, stats polling
│  ├─ load/engine.ts       # virtual users with a changeable target → metrics
│  ├─ check/analyze.ts     # page + bundle → Supabase URL, key, call list
│  ├─ check/run.ts         # check job: analyze, ramp, diagnose
│  ├─ check/diagnose.ts    # metrics → score, breaking point, smells, fixes
│  └─ db.ts                # SQLite
├─ journeys/idea-roaster.json   # hand-written journey
└─ web/                    # Vite + React
   └─ src/
      ├─ useLive.ts        # WebSocket hook, shared by all pages
      ├─ CheckPage.tsx     # /        builder: check and report
      ├─ ShieldPage.tsx    # /shield  builder: Shield switch and live visitors
      └─ DemoPage.tsx      # /demo    us: traffic control and app health
```

## HTTP API

| Method | Path | Used by | What |
|---|---|---|---|
| POST | `/api/checks` | Check page | Start a check: `{ "url": "http://localhost:4173", "maxUsers": 300 }` → `{ "id": "..." }` |
| GET | `/api/checks/latest` | Check page | Last finished result, for a page reload |
| PUT | `/api/shield/config` | Shield page | `{ "siteId": "idea-roaster", "enabled": true, "threshold": 30 }`, forwarded to the Shield service's `PUT /shield/config` |
| POST | `/api/load/start` | Demo panel | Start the load: `{ "url": "http://localhost:4173", "target": 20 }` |
| PUT | `/api/load` | Demo panel | Change the target: `{ "target": 300 }` |
| POST | `/api/load/stop` | Demo panel | End all virtual users |
| WS | `/ws` | All pages | Live data, see below |

- The admit, waitlist and `shield.js` routes are on the Shield service (port 8090), not here. The browser only talks to 8080; the Backend calls the Shield service server to server.
- A check runs in the background. `POST /api/checks` returns right away, and progress comes over the WebSocket.
- One load at a time. Starting a check while the demo load runs returns `409`.

WebSocket messages, server to browser (JSON):

```ts
// every second
{ type: "tick", t: number,
  shield: ShieldStats | null,                // idea-roaster, also when no load runs
  load: null | {
    target: number, users: number, queued: number,
    rps: number, errorRate: number, p95: number,
    health: "healthy" | "degraded" | "down",
    calls: Record<string, { rps: number; errorRate: number; p95: number }>
  } }

// when a check changes step or finishes
{ type: "check", id: string, step: "analyze" | "replay" | "diagnose" | "done",
  progress: number, result?: Result }
```

- Health: down if the error rate is over 5% or p95 over 3000 ms (the breaking-point limits), degraded at half of those, else healthy.

## Shield service link

The admit service and the waitlist live in the Shield service (`user-side/shield/`, port 8090, built by the Target side). Contract in team-plan. This side only talks to it.

```ts
// src/shield.ts
const SHIELD = "http://localhost:8090";

export type ShieldStats = {
  enabled: boolean; threshold: number;
  active: number; queued: number; emails: number; notices: string[];
};

export async function setConfig(siteId: string, enabled: boolean, threshold: number) {
  await fetch(`${SHIELD}/shield/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId, enabled, threshold }),
  });
}

export async function getStats(siteId: string): Promise<ShieldStats | null> {
  try {
    const r = await fetch(`${SHIELD}/shield/stats?siteId=${siteId}`, { signal: AbortSignal.timeout(500) });
    return await r.json();
  } catch {
    return null;   // Shield service not running: the dashboard shows "offline"
  }
}
```

- `live.ts` calls `getStats("idea-roaster")` once a second and puts the answer in the tick.
- Until the Target side has pushed the Shield service, run a stub that answers the same contract, or copy `admit.ts` from the Target spec.

## Check

A check is a background job with these steps. The dashboard shows which step is running.

### 1. Analyze

Input: the app URL. Output: Supabase URL, anon key, and the list of calls in the code.

1. `GET` the page. Collect `<script src="...">` URLs (Vite builds to `/assets/index-<hash>.js`).
2. `GET` each script.
3. Extract with regexes. Vite puts env values into the bundle as plain strings, and minifiers keep method names, so these still match:

   | What | Regex |
   |---|---|
   | Anon key (JWT) | `/eyJ[\w-]+\.[\w-]+\.[\w-]+/` |
   | Supabase URL | `/["'](https?:\/\/[^"']*(?:supabase\.co\|:54321))\/?["']/` |
   | Tables | `/\.from\(["']([\w-]+)["']\)/g` |
   | RPCs | `/\.rpc\(["']([\w-]+)["']/g` |
   | Edge Functions | `/functions\.invoke\(["']([\w-]+)["']/g` |
   | `select *` | `/\.select\(["']\*/g` |

4. If the URL or key isn't found, fall back to the values in `journeys/idea-roaster.json`.

### 2. Journey

The calls one visitor makes, in `journeys/idea-roaster.json`. Written by hand from the Fake App's journey list (Target spec) and checked once against the browser's Network tab.

- A visitor first opens the page (`GET` of the app URL), then `shield.js` calls admit, then the app makes its Supabase calls.
- Keep the order and the repeats.
- Requests the browser sends at the same moment go into one step with `"times": 20, "together": true`. The engine sends them all at once, like the browser does. Sent one by one, they would put far less pressure on the backend than a real visitor, and the breaking point would come out too high.
- Step names are templates (`eq.123` → `eq.:id`), so repeats group together in the results.

```json
{
  "siteId": "idea-roaster",
  "supabaseUrl": "http://localhost:54321",
  "anonKey": "eyJ...",
  "steps": [
    { "name": "GET page", "method": "GET", "url": "http://localhost:4173/", "headers": {}, "body": null },
    { "name": "POST shield/admit", "method": "POST", "url": "http://localhost:8090/shield/admit", "headers": { "content-type": "application/json" }, "body": "{}" },
    { "name": "GET posts", "method": "GET", "url": "http://localhost:54321/rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200", "headers": { "apikey": "eyJ...", "authorization": "Bearer eyJ..." }, "body": null },
    { "name": "HEAD votes", "method": "HEAD", "url": "http://localhost:54321/rest/v1/votes?post_id=eq.1&select=*", "headers": { "apikey": "eyJ...", "authorization": "Bearer eyJ...", "prefer": "count=exact" }, "body": null, "times": 20, "together": true }
  ]
}
```

Known limits of a hand-written journey (the Fake App has neither, so the demo is not affected):

- Retries: some apps re-send a failed request automatically, so under a spike they get even more load. Virtual users don't retry, so such an app could break a bit earlier than we measure.
- Realtime: a live Supabase connection for instant updates is not a normal request, so it can't be in the journey.

### 3. Replay (load engine)

Input: the journey and a target number of users. Output: metrics per second.

`src/load/engine.ts`. The check and the demo panel share it. The check moves the target from 10 to `maxUsers` (default 300) over 60 seconds, then stops. The demo panel sets the target by hand.

- `setTarget(n)` can be called at any time.
- Every 100 ms: if live users are below the target, start new ones until they match. If above, the newest users end after their current step.
- Each virtual user:
  1. Gets its own `sessionId` (`crypto.randomUUID()`).
  2. Runs the steps in order, starting with the page load. A step with `together` sends all its `times` requests at once and waits for all of them before the next step.
  3. On the admit step: sends `{ siteId, sessionId }`. If queued, waits 5 seconds and retries until admitted or it ends. Once admitted, sends a heartbeat every 10 seconds until it ends.
  4. Stays for 30 seconds (the visitor reading the page), then ends. The engine starts a new one in its place, so a steady target means a steady stream of new visitors.
- The journey always has the admit step. With the Shield off, admit answers "admitted" at once, so the same load works before and after the Shield is turned on.
- Only while the Shield is on do virtual users spend time queued. Queued users never hit Supabase, which is the point.

```ts
// src/load/engine.ts (core)
const agent = new Agent({ connections: 1000, headersTimeout: 10_000, bodyTimeout: 10_000 });

async function send(step: Step, body = step.body) {
  const t0 = performance.now();
  try {
    const res = await request(step.url, { method: step.method, headers: step.headers, body, dispatcher: agent });
    const text = await res.body.text();
    record(step.name, res.statusCode, performance.now() - t0);
    return { status: res.statusCode, text };
  } catch {
    record(step.name, 0, performance.now() - t0);   // 0 = timeout or connection error
    return { status: 0, text: "" };
  }
}

async function runStep(step: Step) {
  const n = step.times ?? 1;
  if (step.together) return Promise.all(Array.from({ length: n }, () => send(step)));
  for (let i = 0; i < n; i++) await send(step);
}
```

Metrics, one bucket per second:

```ts
type Bucket = {
  t: number;              // seconds since start
  target: number;         // target users
  users: number;          // live virtual users
  queued: number;         // of those, waiting in the Shield queue
  calls: Record<string, { count: number; errors: number; latencies: number[] }>;
};
```

- An error is status 0 (timeout or connection error) or 5xx.
- Each finished bucket goes to the check job (if one runs) and to `live.ts`, which sends it as the `load` part of the tick.

### 4. Diagnose

Input: buckets, the journey, the analyze result. Output: the result the dashboard shows.

- Breaking point: `users` in the first bucket where the error rate goes above 5% or p95 goes above 3000 ms, across all Supabase calls. If no bucket crosses, it's "didn't break up to `maxUsers`". Show it as "breaks at about N people at the same time".
- Weakest call: the call name that crosses those limits first.
- Code smells:

  | Smell | Rule | Fix prompt |
  |---|---|---|
  | Heavy query | `select=*` in a journey URL, or a response over 100 KB during replay | `fix/feed` |
  | N+1 | A step with `times` 5 or more, or the same step name 5 or more times in one journey | `fix/votes` |
  | Function on page load | Any `/functions/v1/` call in the journey | `fix/ai` |

- Score (0–100) = resilience (0–70) + code (0–30):
  - Resilience = `70 × min(1, breakingPoint / maxUsers)`, or 70 if it didn't break.
  - Code = `30 − 10 × smells`, minimum 0.
  - Story for the demo: about 20 before, 70 with the Shield, 100 with the Shield and the fixes.
- Cost estimate (simplified): for a spike of 10,000 visitors, `Edge Function calls per visitor × 10,000 × $0.01` (the AI calls) plus `other requests × 10,000 × a small fixed price`. Show it as "a 10,000-visitor spike costs about $X".
- Fix prompts: the texts from the Target spec's Fix prompts, picked by smell. Also add "Turn on Spike Shield" when the app broke.
- Threshold suggestion for the Shield: 40% of the breaking point, rounded (e.g. breaks at 80 → 30).

Save the result in SQLite so a page reload keeps it.

## Dashboard (for the builder)

What our customer sees. It only shows what Spike Shield can really know: the check report, and the visitors that pass through the admit service. React pages in `web/`, all fed by `useLive()`.

Check page (`/`):

- URL input (default `http://localhost:4173`) and a Run button.
- While running: current step and a live chart of users and error rate, from the check messages.
- Result: score, breaking point, weakest call, table per call (count, error rate, p95), smells, fix prompts with a copy button, cost estimate.
- Button "Use for Shield": sets the threshold suggestion and opens the Shield page.

Shield page (`/shield`):

- On/off switch and threshold input for `idea-roaster` (`PUT /api/shield/config`). Changes apply at once, also in the middle of a spike.
- Live chart of the last 2 minutes: active and queued visitors stacked, with the threshold as a line.
- Numbers: active, queued, emails captured, and the latest "you're in" notices.
- During the spike with the Shield on, "active" stays flat at the threshold line while "queued" grows. That's the moment to point at in the demo.

## Demo panel (for us)

`/demo`. Not part of the product: it stands in for the internet sending a spike. Open it next to the Shield page during the pitch.

- Traffic slider 0–500 and preset buttons: Quiet (20), Launch (300), Viral (500), Stop. The first press starts the load (`POST /api/load/start`), later changes call `PUT /api/load`.
- Big health badge: healthy, degraded, down.
- Live charts of the last 2 minutes: target vs. live users, error rate, p95.
- Table per call: rps, error rate, p95. The weakest call turns red first.

## Demo script

1. Check page: run the check. Bad score, "breaks at about 80 people at the same time, the feed query fails first". Show the fix prompts.
2. Demo panel: Quiet. Healthy, the Fake App works.
3. Launch. The badge goes red, the Fake App shows errors, Supabase Studio shows the load.
4. Switch the Fake App to the `shield` branch, then turn the Shield on in the Shield page (threshold filled in from the check). Errors drop, active stays flat at the threshold, the queue grows, the Fake App shows the waiting page.
5. Back to Quiet. The queue drains and the "you're in" notices appear.
6. Re-check: good score.

## Build order

Each step is testable alone.

1. Server, WebSocket tick and the Shield service link. Test that the config reaches the Shield service (or a stub on 8090):
   ```bash
   curl -X PUT localhost:8080/api/shield/config -H "content-type: application/json" -d '{"siteId":"idea-roaster","enabled":true,"threshold":2}'
   curl "localhost:8090/shield/stats?siteId=idea-roaster"
   ```
2. Load engine with `journeys/idea-roaster.json`, the load API and the WebSocket. Test against `user-side` once it's pushed.
3. `web/` with the Demo panel and the Shield page. This is the core of the demo.
4. Diagnose and the Check page.
5. Analyze: read the Supabase URL and key from the bundle instead of the JSON file.

If time runs out, step 5 can be cut. The demo still works with the hand-written journey, and the pitch describes it.

## Checklist

1. The Shield page switch reaches the Shield service, and its stats show in the tick
2. The load breaks the Fake App at a stable number of users with the Shield off
3. Turning the Shield on in the middle of a spike brings Supabase errors to zero within a few seconds, with active users flat at the threshold
4. Moving the demo slider changes the charts within 1–2 seconds
5. Check page shows score, breaking point, weakest call, smells, fix prompts, cost
6. Shield page shows live numbers and "you're in" notices
7. The hand-written journey matches the Fake App's Network tab, and analyze works on the Fake App (or the JSON values are ready)
8. Full demo run on this laptop, with `start.sh` and `npm start` from a fresh clone
