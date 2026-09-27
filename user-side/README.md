# user-side: Idea Roaster (Fake App + local Supabase) and the Shield

The customer's side of the demo: a copy of a typical Lovable app that breaks under a small spike
for clear reasons, plus the Shield that keeps it up. Spec:
[fakeapp-scripts-work.md](../fakeapp-scripts-work.md). Roles, ports and the contract:
[team-plan.md](../team-plan.md).

```
user-side/
├─ supabase/          # config, migrations, seed, functions
├─ src/, index.html   # Fake App (Vite + React)
├─ shield/            # Shield service on :8090 (its own package.json, run with tsx)
│  ├─ server.ts       # admit, leave, config, stats, serves public/
│  ├─ admit.ts        # admit logic (in memory)
│  └─ public/shield.js
└─ scripts/           # start.sh, cap.sh, spike.js
```

## Run

Prerequisites: Node 20+, Docker Desktop running, git. The Supabase CLI is a dev dependency, so
`npx supabase` works without a global install (a global `supabase` is used if present).

```bash
./user-side/scripts/start.sh    # from the repo root; Git Bash on Windows
```

It runs `npm install`, `supabase start`, `supabase db reset` (schema + seed, a minute or two),
`scripts/cap.sh`, writes `.env` from the running instance, starts the Shield service, builds
the app twice and serves both builds. Ctrl+C stops the app servers and the Shield service.

| Service | URL |
|---|---|
| Fake App without the Shield | http://localhost:4173 |
| Fake App with the Shield | http://localhost:4174 |
| Shield service (`shield.js`, admit, leave, config, stats) | http://localhost:8090 |
| Supabase API (REST, RPC, Edge Functions) | http://localhost:54321 |
| Supabase Studio | http://localhost:54323 |
| Site id | `idea-roaster` |

Anon key (the local default, the same on every machine; `start.sh` re-reads it from
`supabase status`):

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
```

Check that the API answers:

```bash
curl "http://localhost:54321/rest/v1/posts?select=id,title&limit=1" -H "apikey: <anon key>"
```

Stop Supabase with `npx supabase stop` (from `user-side/`).

## App

Pages:

- `/` Feed: 200 latest ideas with author and vote count, plus an "Idea of the day" card with an
  AI roast.
- `/idea/:id` Detail: full idea text, vote count and a "Roast this idea" button.

Stack: Vite 5 + React + TypeScript + `@supabase/supabase-js`, served as a production build with
`vite preview`, like Lovable's CDN.

### Two builds

The demo serves the app without and with the Shield at the same time, so nothing is switched or
rebuilt live. Both builds come from the same code:

```bash
npm run build -- --outDir dist-plain             # without the Shield -> :4173
SHIELD=1 npm run build -- --outDir dist-shield   # with the Shield    -> :4174
```

With `SHIELD=1` a small plugin in `vite.config.ts` adds the install prompt's script tag as the
first script in `<head>`. `src/main.tsx` always waits for `window.SpikeShield?.ready`; without the
script it starts at once. These are the two changes the install prompt makes (the `shield` branch
shows them as a plain diff).

### Page states

The rush tester reads what each visitor sees from `<body data-state>`:

- `loading`: the app is starting or waiting for the feed (set in `index.html`)
- `ready`: the feed rendered with data
- `error`: a Supabase call failed; the page also shows "Something went wrong"

The waiting page from `shield.js` has `id="spike-shield"`, which the tester checks first.

### Intentional weak points

| # | Weak point | Where | Fix branch (stretch) |
|---|---|---|---|
| 1 | Heavy feed query: 200 posts, `select *` with the long `body`, joined with the author, ordered by `created_at` without an index | `src/pages/Feed.tsx` | `fix/feed` |
| 2 | N+1 vote counts: one `HEAD` request per post for the first 20 posts, all at the same moment; `votes.post_id` has no index so each one scans 500k rows | `src/pages/Feed.tsx` | `fix/votes` |
| 3 | AI call on every page load: the "Idea of the day" card calls the `ai-summary` Edge Function (2 s simulated latency, no cache) on every feed load | `src/pages/Feed.tsx`, `supabase/functions/ai-summary` | `fix/ai` |

Schema: `supabase/migrations/20260926000000_init.sql` (no index on `posts(created_at)` or
`votes(post_id)`). Seed: `supabase/seed.sql` (1,000 profiles, 100,000 posts, 500,000 votes).

Calls the feed makes, in order: `GET /rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200`,
then in one burst `HEAD /rest/v1/votes?select=*&post_id=eq.<id>` × 20 (`Prefer: count=exact`) and
`POST /functions/v1/ai-summary`. Every call sends `apikey` and `Authorization: Bearer <anon key>`.

## Shield service

`shield/`, one Node process on `localhost:8090` (Express, run with `tsx`, no build step). It
stands in for our CDN and hosted admit service: all state is in memory, a restart clears it. It
starts with `idea-roaster` enabled and the threshold from the `THRESHOLD` env var (default 10).
Only the `:4174` build loads the script, so the Shield can stay on all the time.

| Method | Path | Used by | What |
|---|---|---|---|
| GET | `/shield.js` | Fake App (`:4174`) | Static file from `shield/public/` |
| POST | `/shield/admit` | `shield.js` | `{ siteId, sessionId }` → `{ status: "admitted" }` or `{ status: "queued", position }` |
| POST | `/shield/leave` | `shield.js` (`sendBeacon`, `text/plain`) | `{ siteId, sessionId }` → `204`, the session is dropped at once |
| PUT | `/shield/config` | us, for tuning | `{ siteId, enabled, threshold }` → `204` |
| GET | `/shield/stats?siteId=…` | Tester dashboard | `{ enabled, threshold, active, queued }` |

Sessions not seen for 30 s are dropped; a closed tab sends "leave" and frees its place at once (a
reload counts as leaving too, so don't reload while demoing the waiting page).

To run only the Shield service: `cd user-side/shield && npm install && THRESHOLD=10 npm start`.

Contract test:

```bash
curl -X PUT localhost:8090/shield/config -H "content-type: application/json" -d '{"siteId":"idea-roaster","enabled":true,"threshold":2}'
curl -X POST localhost:8090/shield/admit -H "content-type: application/json" -d '{"siteId":"idea-roaster","sessionId":"a"}'
curl -X POST localhost:8090/shield/leave -H "content-type: text/plain" -d '{"siteId":"idea-roaster","sessionId":"a"}'
curl "localhost:8090/shield/stats?siteId=idea-roaster"
```

With threshold 2, the third new session is queued. After a leave, the next queued session is
admitted on its next retry.

## Resource caps

`scripts/cap.sh` caps the Supabase containers (db: 1 CPU / 1 GB, rest: 0.5 CPU / 512 MB, edge
runtime: 0.5 CPU / 512 MB). The rush tester runs real browsers on the same laptop, so the caps
must make the app break at about 20–30 visitors at the same time and stay healthy at the Shield
threshold (10). The caps reset on every Supabase restart; `start.sh` re-applies them. Tune on the
demo laptop, roughly with k6 first, then with the rush tester:

```bash
k6 run -e URL=http://localhost:54321 -e KEY=<anon key> user-side/scripts/spike.js
```

If it does not break at the planned number, tighten the caps first, then raise the number of
posts with vote counts (`VOTE_COUNT_POSTS` in `src/pages/Feed.tsx`).

`supabase/config.toml` disables Realtime, Storage and Analytics to keep the Docker footprint small
on the demo laptop; Studio stays on.

## Branches

- `shield`: the two install-prompt changes as a plain diff (script tag in `index.html`, wait in
  `main.tsx`). The demo itself uses the `:4174` build instead of switching branches.
- `fix/feed`, `fix/votes`, `fix/ai` (stretch): each one applies one fix prompt from the spec and
  adds a migration. Switch with `git checkout <branch>`, rebuild, and run `npx supabase db reset`
  to apply the new migration.
