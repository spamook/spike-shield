# Spike Shield: Team Plan

How we split the work so both sides can build in parallel. See [spike-shield.md](spike-shield.md) for the product and architecture.

## Roles

| | Tester side (Koki) | Target side (Danila) |
|---|---|---|
| Builds | Backend: check, admit service, dashboard | Fake App, local Supabase, shield.js (script + waiting page) |
| Demo role | Runs the check, shows the score and Shield stats | Installs the Shield, shows the app and Supabase Studio |

Work spec for the Target side: [fakeapp-scripts-work.md](fakeapp-scripts-work.md).

## Setup

We each build on our own laptop. The demo runs on one laptop (Koki's), so the Target side must start from the repo with a few commands (see the Target spec).

The repo is split into the customer's side and ours. It's a demo, so neither side copies the real product's infrastructure.

```
spike-shield/
├─ user-side/            # Danila: the customer's app
│  ├─ supabase/          # config, migrations, seed, functions (Supabase CLI, runs in Docker)
│  ├─ src/, index.html   # Fake App (Vite + React)
│  └─ scripts/           # start.sh, cap.sh
└─ our-side/            # Koki: Spike Shield
   ├─ src/               # one Node process: dashboard, check, admit API
   ├─ public/shield.js   # built by Danila, served by our-side
   └─ package.json       # npm start
```

Run the demo:

```bash
./user-side/scripts/start.sh    # Supabase + caps + Fake App on :4173
cd our-side && npm start        # Backend on :8080
```

- Only Supabase runs in Docker. Our side runs directly on the laptop, so `localhost` works everywhere.

| Service | Port |
|---|---|
| Fake App (`vite preview`) | 4173 |
| Supabase API (REST, RPC, Edge Functions) | 54321 |
| Supabase Studio | 54323 |
| Backend (dashboard, check, admit service, `shield.js`) | 8080 |

- The load generator and Supabase share the same CPU. Keep the Supabase caps tight so Supabase breaks first, not the Backend. The Backend's own per-call latency is the check: if the admit service gets slow, the caps are too loose.
- Close other heavy apps during the demo.

## Tester side

One Node/TypeScript process on port 8080. SQLite for results, sites and the waitlist.

### Check

1. Analyze
   - Fetch the page, find `<script>` tags, download the JS bundle.
   - Extract the Supabase URL and anon key (the URL pattern and the JWT-shaped key).
   - List call patterns: `.from('...')`, `.select(...)`, `.rpc('...')`, `functions.invoke('...')`.
2. Record
   - Open the app once with Playwright and log every request to the Supabase URL and to our admit service: method, path, query, body, response size, time.
   - The recorded list is the journey. Fallback: the hand-written journey from the Target side.
3. Replay
   - Ramp virtual users (e.g. 10 → 300 over 60 seconds). Each one runs the journey once, then stays on the page for 30 seconds.
   - If the journey starts with an admit call, follow the answer: admitted users run the rest and send heartbeats every 10 seconds; queued users retry every 5 seconds.
   - Record status, latency and errors per call, bucketed by the number of active virtual users.
4. Diagnose
   - Breaking point: the user count where the error rate goes above 5% or p95 latency above 3 seconds.
   - Weakest call: the call that crosses those limits first.
   - Code smells from steps 1 and 2: `select *` without a limit, the same call repeated per list item, Edge Function calls on page load.
   - Score (0–100): breaking point against a target of 500 users, minus points per code smell.
   - Cost estimate (simplified): requests per visitor × expected spike size × a fixed price per request.
   - Fix prompts: fixed templates matched to each finding (see Fix prompts in the Target spec).

### Admit service

Keeps an in-memory map per site: session id → status, first seen, last seen.

- On each admit call, drop sessions not seen for 30 seconds, then:
  - Shield disabled for this site → admitted.
  - Known active session → update last seen, admitted.
  - Active count + queued visitors ahead of this one < threshold → mark active, admitted.
  - Otherwise → queued, with position.
- First come, first served: queued sessions keep their place as long as they keep polling.
- Node runs one thread, so no locks are needed.
- Send CORS headers, since the Fake App runs on a different origin.
- Serve `shield.js` (built by the Target side) as a static file.

### Dashboard

Served by the Backend.

- Check page: URL input, progress, then score, breaking point, per-call table, code smells, fix prompts.
- Shield page: on/off per site, threshold (pre-filled from the last check's breaking point), live active visitors, queue length, emails captured.
- Updates every 1–2 seconds.

## Contract between the two sides

Agree on these first, then build independently.

1. Addresses: Fake App URL, Supabase URL and anon key. Shared by hand at first; the check reads them from the bundle later.
2. Journey: the calls one visitor makes, recorded automatically. The Target side also writes them down as a fallback and to check the recording against.
3. Site id: `idea-roaster`.
4. Admit API (Tester side serves, `shield.js` calls):
   - `POST http://localhost:8080/shield/admit` with `{ "siteId": "idea-roaster", "sessionId": "<uuid>" }`
   - → `{ "status": "admitted" }` or `{ "status": "queued", "position": 42 }`
   - Called on page load, then every 10 seconds while admitted (heartbeat) and every 5 seconds while queued.
5. Waitlist API:
   - `POST http://localhost:8080/shield/waitlist` with `{ "siteId": "idea-roaster", "sessionId": "<uuid>", "email": "..." }` → `204`
6. Script: served at `http://localhost:8080/shield.js`, loaded by the Fake App with `<script src="http://localhost:8080/shield.js" data-site="idea-roaster" data-api="http://localhost:8080"></script>`.
7. Shield on/off and the threshold live in the Tester dashboard.

## Demo script

1. Paste the Fake App URL and run the check: bad score, "breaks at about N users, the feed query fails first". Show errors in Supabase Studio.
2. Show the fix prompts.
3. Show the Shield install prompt, then switch the Fake App to the `shield` branch. Turn the Shield on in the dashboard; the threshold is filled in from the check.
4. Spike again: the waiting page appears, the app stays up, active visitors stay at the threshold, emails are captured.
5. Re-check: good score.
