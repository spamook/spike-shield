# Spike Shield: Team Plan

How we split the work so both sides can build in parallel. See [spike-shield.md](spike-shield.md) for the product.

## Roles

| | Tester side (Koki) | Target side (Danila) |
|---|---|---|
| Builds | Rush tester: Playwright runner and tester dashboard | Fake App (two builds), local Supabase, Shield (shield.js, waiting page, admit service) |
| Demo role | Runs the tester, shows the dashboard | Shows the install prompt, the app and Supabase Studio |

Work specs: [tester-work.md](tester-work.md) (Tester side) and [fakeapp-scripts-work.md](fakeapp-scripts-work.md) (Target side).

Priority: the Fake App, the Shield and the rush tester come first. Everything in Stretch waits until the full demo runs.

## Setup

We each build on our own laptop. The demo runs on one laptop (Koki's), so both sides must start from the repo with a few commands.

```
spike-shield/
├─ user-side/            # Danila: the customer's app and the Shield
│  ├─ supabase/          # config, migrations, seed, functions (Supabase CLI, runs in Docker)
│  ├─ src/, index.html   # Fake App (Vite + React)
│  ├─ shield/            # Shield service: shield.js, admit API (in memory)
│  └─ scripts/           # start.sh, cap.sh
└─ tester/               # Koki: rush tester
   ├─ src/               # one Node process: Playwright runner, API, WebSocket
   ├─ web/               # tester dashboard (Vite + React), built into web/dist
   └─ package.json       # npm start (builds web/, then starts the server)
```

Run the demo:

```bash
./user-side/scripts/start.sh    # Supabase + caps + Shield on :8090 + Fake App on :4173 and :4174
cd tester && npm start          # rush tester and dashboard on :8080
```

| Service | Port |
|---|---|
| Fake App without the Shield (`vite preview`) | 4173 |
| Fake App with the Shield (`vite preview`) | 4174 |
| Supabase API (REST, RPC, Edge Functions) | 54321 |
| Supabase Studio | 54323 |
| Shield service (`shield.js`, admit) | 8090 |
| Rush tester and dashboard | 8080 |
| Dashboard dev server (only while building the frontend) | 5173 |

- Only Supabase runs in Docker.
- Playwright browsers and Supabase share the same CPU. Real browsers are heavy, so the Supabase caps must make the app break well below the number of browsers the laptop can run.
- Close other heavy apps during the demo.

## Contract between the two sides

Agree on these first, then build independently.

1. Addresses: `http://localhost:4173` (without the Shield) and `http://localhost:4174` (with the Shield).
2. Page states, so the tester can tell what a visitor sees. The Fake App sets `data-state` on `<body>`:
   - `loading`: the app is starting or waiting for data
   - `ready`: the feed rendered with data
   - `error`: a Supabase call failed and the app shows an error
   - The waiting page has `id="spike-shield"`.
3. Supabase calls go to `http://localhost:54321`. The tester counts every response from that origin.
4. Site id: `idea-roaster`. One site, no login.
5. Admit API (Shield service serves, `shield.js` calls):
   - `POST http://localhost:8090/shield/admit` with `{ "siteId": "idea-roaster", "sessionId": "<uuid>" }`
   - → `{ "status": "admitted" }` or `{ "status": "queued", "position": 42 }`
   - Called on page load, then every 10 seconds while admitted (heartbeat) and every 5 seconds while queued.
6. Leave API: `POST http://localhost:8090/shield/leave` with `{ "siteId": "idea-roaster", "sessionId": "<uuid>" }` (sent as `text/plain` by `sendBeacon` when the page closes) → `204`. The session is dropped at once, so its slot or place in line frees.
7. Script: `<script src="http://localhost:8090/shield.js" data-site="idea-roaster" data-api="http://localhost:8090"></script>`, only in the `:4174` build.
8. Shield stats and config (Shield service serves, the tester dashboard reads):
   - `GET http://localhost:8090/shield/stats?siteId=idea-roaster` → `{ "enabled": true, "threshold": 10, "active": 10, "queued": 12 }`
   - `PUT http://localhost:8090/shield/config` with `{ "siteId": "idea-roaster", "enabled": true, "threshold": 10 }` → `204`. For tuning only; the Shield service starts enabled with the threshold from its `THRESHOLD` env var.

## Demo script

1. A short introduction.
2. Tester dashboard: run "Without Shield" (`:4173`). Supabase Studio shows the load.
3. The dashboard shows many failed requests and visitors who got an error.
4. Introduce the Shield: the install prompt and what it adds to the app.
5. Run "With Shield" (`:4174`). While it runs, open `:4174` in our own browser and wait: the waiting page, our position counting down, then the app opens (about 20–30 seconds). Mention that email notification ("leave your email, we tell you when you're in") comes next.
6. The dashboard shows no failed requests, active visitors flat at the threshold, and part of the visitors on the waiting page.

## Stretch

Only after the full demo runs on the demo laptop.

1. Fix prompts and `fix/*` branches (Target side).
2. Email form on the waiting page, and "you're in" notices when a slot frees up (sent a few at a time, as many as free slots).
3. Login page for builders, with a site key for the script.
4. Builder dashboard: active visitors, queue and waitlist.
5. Threshold suggestion from static analysis of the app's HTML, CSS and JS.
