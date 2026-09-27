# Spike Shield: Team Plan

How we split the work so both sides can build in parallel. See [spike-shield.md](spike-shield.md) for the product and architecture.

## Roles

| | Tester side (Koki) | Target side (Danila) |
|---|---|---|
| Builds | Backend: check, load engine, dashboard, demo panel | Fake App, local Supabase, Shield (shield.js, waiting page, admit service, waitlist) |
| Demo role | Runs the check, drives the spike from the demo panel, flips the Shield | Installs the Shield, shows the app and Supabase Studio |

Work specs: [tester-work.md](tester-work.md) (Tester side) and [fakeapp-scripts-work.md](fakeapp-scripts-work.md) (Target side).

## Setup

We each build on our own laptop. The demo runs on one laptop (Koki's), so the Target side must start from the repo with a few commands (see the Target spec).

The repo is split by owner, so each folder is one person's work. It's a demo, so neither side copies the real product's infrastructure.

```
spike-shield/
├─ user-side/            # Danila: the customer's app and the Shield
│  ├─ supabase/          # config, migrations, seed, functions (Supabase CLI, runs in Docker)
│  ├─ src/, index.html   # Fake App (Vite + React)
│  ├─ shield/            # Shield service: shield.js, admit API, waitlist (in memory)
│  └─ scripts/           # start.sh, cap.sh
└─ service-side/         # Koki: check, load, dashboard
   ├─ src/               # one Node process: check, load engine, WebSocket
   ├─ web/               # dashboard + demo panel (Vite + React), built into web/dist
   └─ package.json       # npm start (builds web/, then starts the server)
```

Run the demo:

```bash
./user-side/scripts/start.sh    # Supabase + caps + Shield service on :8090 + Fake App on :4173
cd service-side && npm start    # Backend on :8080
```

- Only Supabase runs in Docker. The Shield service and the Backend run directly on the laptop, so `localhost` works everywhere.

| Service | Port |
|---|---|
| Fake App (`vite preview`) | 4173 |
| Supabase API (REST, RPC, Edge Functions) | 54321 |
| Supabase Studio | 54323 |
| Shield service (`shield.js`, admit, waitlist) | 8090 |
| Backend (dashboard, check, load engine) | 8080 |
| Dashboard dev server (only while building the frontend) | 5173 |

- The load generator and Supabase share the same CPU. Keep the Supabase caps tight so Supabase breaks first, not the Backend or the Shield service. The admit call's own latency is the check: if it gets slow, the caps are too loose.
- Close other heavy apps during the demo.

## Tester side

One Node/TypeScript process on port 8080. SQLite for check results. Live data goes to the browser over a WebSocket. No login: one site, `idea-roaster`.

The check spike-tests the customer's service: virtual visitors do what real visitors' browsers do, and it finds how many people at the same time break the app. The Shield then protects the service from spike traffic.

### Check

1. Analyze
   - Fetch the page, find `<script>` tags, download the JS bundle.
   - Extract the Supabase URL and anon key (the URL pattern and the JWT-shaped key).
   - List call patterns: `.from('...')`, `.select(...)`, `.rpc('...')`, `functions.invoke('...')`.
2. Journey
   - The calls one visitor makes: open the page, admit, then the app's Supabase calls. Hand-written from the Target side's list, no Playwright in the demo.
3. Replay (spike test of the service)
   - Uses the load engine: virtual users with a target count that can change while they run. The check ramps the target (e.g. 10 → 300 over 60 seconds); the demo panel sets it by hand.
   - Each virtual user runs the journey once, stays on the page for 30 seconds, and is replaced by a new one.
   - If the journey starts with an admit call, follow the answer: admitted users run the rest and send heartbeats every 10 seconds; queued users retry every 5 seconds.
   - Record status, latency and errors per call, bucketed by the number of active virtual users.
4. Diagnose
   - Breaking point: the user count where the error rate goes above 5% or p95 latency above 3 seconds, shown as "about N people at the same time".
   - Weakest call: the call that crosses those limits first.
   - Code smells from the bundle and the journey: `select *` without a limit, the same call repeated per list item, Edge Function calls on page load.
   - Score (0–100): resilience (0–70) from the breaking point plus code (0–30) minus points per smell. Formula in tester-work.md.
   - Cost estimate (simplified): requests per visitor × expected spike size × a fixed price per request.
   - Fix prompts: fixed templates matched to each finding (see Fix prompts in the Target spec).

### Dashboard (for the builder)

Served by the Backend, live over the WebSocket. Shows only what Spike Shield can really know. Shield numbers come from the Shield service's stats API, and the switch calls its config API.

- Check page: URL input, progress, then score, breaking point, per-call table, code smells, fix prompts.
- Shield page: on/off per site, threshold (pre-filled from the last check's breaking point), live chart of active and queued visitors against the threshold, emails captured. Can be flipped in the middle of a spike.

### Demo panel (for us)

Not part of the product. Stands in for the internet sending a spike.

- Traffic slider and presets (Quiet 20, Launch 300, Viral 500) that change the load while it runs.
- App health (healthy, degraded, down), error rate and p95 per call.

## Target side

Fake App, local Supabase and the Shield. Details in [fakeapp-scripts-work.md](fakeapp-scripts-work.md).

### Shield service

One small Node/TypeScript process on port 8090 in `user-side/shield/`. Serves `shield.js` and runs the admit API and the waitlist.

- All state is in memory: sessions, emails, "you're in" notices. A restart clears it, which is fine for the demo. The real product keeps sessions in an edge store (e.g. Redis) and emails in its own database, never in the customer's Supabase.
- Keeps a map per site: session id → status, first seen, last seen, email.
- On each admit call, drop sessions not seen for 30 seconds, then:
  - Shield disabled for this site → admitted.
  - Known active session → update last seen, admitted.
  - Active count + queued visitors ahead of this one < threshold → mark active, admitted.
  - Otherwise → queued, with position.
- First come, first served: queued sessions keep their place as long as they keep polling.
- Node runs one thread, so no locks are needed.
- Send CORS headers, since the Fake App runs on a different origin.

## Contract between the two sides

Agree on these first, then build independently.

1. Addresses: Fake App URL, Supabase URL and anon key. Shared by hand at first; the check reads them from the bundle later.
2. Journey: the calls one visitor makes, starting with the page load. The Target side writes them down from the browser's Network tab; the Tester side turns them into `journeys/idea-roaster.json`.
3. Site id: `idea-roaster`. One site, no login.
4. Admit API (Shield service serves, `shield.js` and the replay call):
   - `POST http://localhost:8090/shield/admit` with `{ "siteId": "idea-roaster", "sessionId": "<uuid>" }`
   - → `{ "status": "admitted" }` or `{ "status": "queued", "position": 42 }`
   - Called on page load, then every 10 seconds while admitted (heartbeat) and every 5 seconds while queued.
5. Waitlist API:
   - `POST http://localhost:8090/shield/waitlist` with `{ "siteId": "idea-roaster", "sessionId": "<uuid>", "email": "..." }` → `204`
6. Script: served at `http://localhost:8090/shield.js`, loaded by the Fake App with `<script src="http://localhost:8090/shield.js" data-site="idea-roaster" data-api="http://localhost:8090"></script>`.
7. Shield control API (Shield service serves, the Tester Backend calls):
   - `PUT http://localhost:8090/shield/config` with `{ "siteId": "idea-roaster", "enabled": true, "threshold": 30 }` → `204`
   - `GET http://localhost:8090/shield/stats?siteId=idea-roaster` → `{ "enabled": true, "threshold": 30, "active": 30, "queued": 12, "emails": 3, "notices": ["You're in: a@b.c"] }`
   - The switch and the threshold live in the Tester dashboard. The Backend polls stats every second.

## Demo script

1. Paste the Fake App URL and run the check: bad score, "breaks at about N people at the same time, the feed query fails first". Show the fix prompts.
2. Demo panel: Quiet traffic, the app is healthy. Then Launch: it goes red, the Fake App shows errors, Supabase Studio shows the load.
3. While the spike runs: show the Shield install prompt, switch the Fake App to the `shield` branch, turn the Shield on in the dashboard (threshold filled in from the check).
4. Errors drop, the waiting page appears, active visitors stay flat at the threshold, the queue grows, emails are captured.
5. Back to Quiet: the queue drains, "you're in" notices appear.
6. Re-check: good score.
