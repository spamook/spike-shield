# user-side: Idea Roaster (Fake App + local Supabase)

The customer's side of the demo: a copy of a typical Lovable app that breaks under a small spike
for clear reasons. Spec: [fakeapp-scripts-work.md](../fakeapp-scripts-work.md). Roles, ports and
the API contract: [team-plan.md](../team-plan.md).

## Run

Prerequisites: Node 20+, Docker Desktop running, git. The Supabase CLI is a dev dependency, so
`npx supabase` works without a global install (a global `supabase` is used if present).

```bash
./user-side/scripts/start.sh    # from the repo root; Git Bash on Windows
```

It runs `npm install`, `supabase start`, `supabase db reset` (schema + seed, a minute or two),
`scripts/cap.sh`, writes `.env` from the running instance, builds and serves the app.

| Service | URL |
|---|---|
| Fake App (`vite preview`) | http://localhost:4173 |
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
| 0 | `POST http://localhost:8080/shield/admit` | `shield` branch only, before anything else |
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

## Branches

- `shield`: the Shield installed with the install prompt (script tag in `index.html`, `main.tsx`
  waits for `window.SpikeShield.ready`). The script itself is `our-side/public/shield.js`, served
  by the Backend at `http://localhost:8080/shield.js`.
- `fix/feed`, `fix/votes`, `fix/ai`: each one applies one fix prompt from the spec and adds a
  migration. Switch with `git checkout <branch>`, then `npm run build` and, for the fix branches,
  `npx supabase db reset` to apply the new migration.
