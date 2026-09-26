# user-side: Idea Roaster (Fake App + local Supabase) and the Shield service

The customer's side of the demo: a copy of a typical Lovable app that breaks under a small spike
for clear reasons, plus the Shield service that keeps it up. Spec:
[fakeapp-scripts-work.md](../fakeapp-scripts-work.md). Roles, ports and the API contract:
[team-plan.md](../team-plan.md).

```
user-side/
├─ supabase/          # config, migrations, seed, functions
├─ src/, index.html   # Fake App (Vite + React)
├─ shield/            # Shield service on :8090 (its own package.json, run with tsx)
│  ├─ server.ts       # admit, waitlist, config, stats, serves public/
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
`scripts/cap.sh`, writes `.env` from the running instance, starts the Shield service in the
background, builds and serves the app. Ctrl+C stops the app and the Shield service.

| Service | URL |
|---|---|
| Fake App (`vite preview`) | http://localhost:4173 |
| Shield service (`shield.js`, admit, waitlist, config, stats) | http://localhost:8090 |
| Supabase API (REST, RPC, Edge Functions) | http://localhost:54321 |
| Supabase Studio | http://localhost:54323 |
| Site id | `idea-roaster` |

To run only the Shield service: `cd user-side/shield && npm install && npm start`.

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
`vite preview`, like Lovable's CDN. The Supabase URL, anon key and every call pattern
(`.from("posts")`, `.select("*, author:profiles(*)")`, `invoke("ai-summary")`) are visible in the
JS bundle, which is what the check's Analyze step reads.

## Intentional weak points

| # | Weak point | Where | Fix branch |
|---|---|---|---|
| 1 | Heavy feed query: 200 posts, `select *` with the long `body`, joined with the author, ordered by `created_at` without an index | `src/pages/Feed.tsx` | `fix/feed` |
| 2 | N+1 vote counts: one `HEAD` request per post for the first 20 posts, `votes.post_id` has no index so each one scans 500k rows | `src/pages/Feed.tsx` | `fix/votes` |
| 3 | AI call on every page load: the "Idea of the day" card calls the `ai-summary` Edge Function (2 s simulated latency, no cache) on every feed load | `src/pages/Feed.tsx`, `supabase/functions/ai-summary` | `fix/ai` |

Schema: `supabase/migrations/20260926000000_init.sql` (no index on `posts(created_at)` or
`votes(post_id)`). Seed: `supabase/seed.sql` (1,000 profiles, 100,000 posts, 500,000 votes).

## Journey

The calls one visitor makes on the feed, in order, recorded from the built app's Network tab:

| # | Call | Notes |
|---|---|---|
| 0 | `POST http://localhost:8090/shield/admit` | `shield` branch only, before anything else |
| 1 | `GET /rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200` | ~300 KB response |
| 2 | `HEAD /rest/v1/votes?select=*&post_id=eq.<id>` × 20 | header `Prefer: count=exact`, count comes back in `Content-Range` |
| 3 | `POST /functions/v1/ai-summary` | body `{"post_id":<id of the newest post>}`, ~2 s |

Every Supabase call sends `apikey: <anon key>` and `Authorization: Bearer <anon key>`. The
browser sends a CORS preflight (`OPTIONS`) before each of them; the load test can skip those.

The detail page adds: `GET /rest/v1/posts?select=*,author:profiles(*)&id=eq.<id>`
(`Accept: application/vnd.pgrst.object+json`), one `HEAD` vote count, and `POST
/functions/v1/ai-summary` when the button is clicked.

## Resource caps

`scripts/cap.sh` caps the Supabase containers (db: 1 CPU / 1 GB, rest: 0.5 CPU / 512 MB, edge
runtime: 0.5 CPU / 512 MB) so Supabase breaks first, at about 80–150 users. The caps reset on
every Supabase restart; `start.sh` re-applies them. Tune on the demo laptop until the breaking
point is stable:

```bash
k6 run -e URL=http://localhost:54321 -e KEY=<anon key> user-side/scripts/spike.js
```

If it does not break under ~150 users, tighten the caps first, then raise the number of posts with
vote counts (`VOTE_COUNT_POSTS` in `src/pages/Feed.tsx`).

`supabase/config.toml` disables Realtime, Storage and Analytics to keep the Docker footprint small
on the demo laptop; Studio stays on.

## Shield service

`shield/`, one Node process on `localhost:8090` (Express, run with `tsx`, no build step). It
stands in for our CDN and hosted admit service: all state is in memory, a restart clears it.

| Method | Path | Used by | What |
|---|---|---|---|
| GET | `/shield.js` | Fake App | Static file from `shield/public/` |
| POST | `/shield/admit` | `shield.js`, Tester replay | `{ siteId, sessionId }` → `{ status: "admitted" }` or `{ status: "queued", position }` |
| POST | `/shield/waitlist` | `shield.js` | `{ siteId, sessionId, email }` → `204` |
| PUT | `/shield/config` | Tester Backend | `{ siteId, enabled, threshold }` → current stats |
| GET | `/shield/stats?siteId=…` | Tester Backend | `{ enabled, threshold, active, queued, emails, notices }` |

A new site starts disabled with threshold 30, so the Shield does nothing until the Tester
dashboard turns it on. Sessions not seen for 30 s are dropped. "You're in" emails are not sent
in the demo; they appear as `notices` in the stats.

Contract test:

```bash
curl -X PUT localhost:8090/shield/config -H "content-type: application/json" -d '{"siteId":"idea-roaster","enabled":true,"threshold":2}'
curl -X POST localhost:8090/shield/admit -H "content-type: application/json" -d '{"siteId":"idea-roaster","sessionId":"a"}'
curl "localhost:8090/shield/stats?siteId=idea-roaster"
```

With threshold 2, the third new session is queued.

## Branches

- `shield`: the Shield installed with the install prompt (script tag in `index.html`, `main.tsx`
  waits for `window.SpikeShield.ready`). The script itself is `shield/public/shield.js`, served
  by the Shield service at `http://localhost:8090/shield.js`.
- `fix/feed`, `fix/votes`, `fix/ai`: each one applies one fix prompt from the spec and adds a
  migration. Switch with `git checkout <branch>`, then `npm run build` and, for the fix branches,
  `npx supabase db reset` to apply the new migration.
