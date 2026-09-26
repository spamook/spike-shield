# Target Side: Fake App + Shield Script

Work spec for the Target side. See [team-plan.md](team-plan.md) for roles, ports and the API contract, and [spike-shield.md](spike-shield.md) for the product.

## Goal

Build a copy of a typical Lovable app that breaks under a small spike for clear reasons, and the `shield.js` script that keeps it up.

What you hand to the Tester side:

- Fake App URL, Supabase URL and anon key
- The list of calls the page makes (see Journey)
- `shield.js` (committed to `our-side/public/`; the Tester Backend serves it)
- Fix branches that each remove one weak point (see Fix prompts)

## Your folders

```
spike-shield/
├─ user-side/            # yours: Fake App + Supabase
│  ├─ supabase/          # config, migrations, seed, functions
│  ├─ src/, index.html   # Fake App (Vite + React)
│  ├─ scripts/start.sh   # starts everything on this side
│  └─ scripts/cap.sh     # Docker resource caps
└─ our-side/
   └─ public/shield.js   # yours too; the rest of our-side is Koki's
```

Only Supabase runs in Docker (the CLI needs it). The Fake App runs directly with `vite preview`.

## Stack

The same stack Lovable generates, run locally:

- Vite + React + TypeScript
- `@supabase/supabase-js`
- Local Supabase in Docker (Postgres, REST API, Edge Functions, Studio)

Prerequisites: Node 20+, Docker Desktop, Supabase CLI, git.

## Setup

```bash
# from the repo root
npm create vite@latest user-side -- --template react-ts
cd user-side
npm install @supabase/supabase-js
supabase init           # project_id in supabase/config.toml becomes "user-side"
supabase start          # prints API URL, anon key, Studio URL
```

- Put the schema in `supabase/migrations/<timestamp>_init.sql` and the seed in `supabase/seed.sql`. `supabase db reset` applies both.
- `.env`:

  ```
  VITE_SUPABASE_URL=http://localhost:54321
  VITE_SUPABASE_ANON_KEY=<anon key from supabase start>
  ```

- `src/lib/supabase.ts`:

  ```ts
  import { createClient } from "@supabase/supabase-js";
  export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  ```

- Serve the production build, like Lovable's CDN does:

  ```bash
  npm run build && npx vite preview --port 4173
  ```

- Check that the API answers:

  ```bash
  curl "http://localhost:54321/rest/v1/posts?limit=1" -H "apikey: <anon key>"
  ```

## Resource caps

A laptop is much stronger than a free-tier Supabase, and in the demo the load generator runs on the same laptop. Cap the containers so Supabase breaks first, at a predictable point (aim for 80–150 users).

```bash
docker ps --format "{{.Names}}"          # find supabase_db_*, supabase_rest_*, supabase_edge_runtime_*
docker update --cpus 1 --memory 1g supabase_db_user-side
docker update --cpus 0.5 --memory 512m supabase_rest_user-side
```

- Container names end with the `project_id` from `supabase/config.toml`. Check them with `docker ps`.
- Caps reset when Supabase restarts. Keep the commands in `user-side/scripts/cap.sh`; `start.sh` runs it after `supabase start`.
- Tune the numbers with the k6 script below until the breaking point is stable across runs.
- Tune them on the demo laptop, not only on yours. A different CPU gives a different breaking point.

## Run on the demo laptop

The demo runs on Koki's laptop, so everything must start from the repo without manual steps. Provide `user-side/scripts/start.sh`:

```bash
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."    # user-side/
supabase start
supabase db reset          # schema + seed
./scripts/cap.sh           # resource caps
npm install && npm run build && npx vite preview --port 4173
```

Koki runs it with `./user-side/scripts/start.sh` (Git Bash on Windows).

- Local Supabase normally uses the same default anon key on every machine. Check that `supabase start` prints the same key on Koki's laptop; if so, `.env` can be committed.
- Do a full run on Koki's laptop at least once before the demo day.

## App concept: Idea Roaster

A viral-style app: people post startup ideas, the feed shows them with votes, and an AI "roasts" an idea.

Pages:

- `/` Feed: list of ideas (title, author, vote count) and an "Idea of the day" card with an AI roast.
- `/idea/:id` Detail: full idea text and a "Roast this idea" button.

## Database

`supabase/migrations/<timestamp>_init.sql`:

```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  avatar_url text
);

create table posts (
  id bigint generated always as identity primary key,
  author_id uuid references profiles(id),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table votes (
  id bigint generated always as identity primary key,
  post_id bigint references posts(id),
  created_at timestamptz not null default now()
);

-- Intentionally NO index on posts(created_at) or votes(post_id).
-- Postgres does not index foreign keys automatically.

alter table profiles enable row level security;
alter table posts enable row level security;
alter table votes enable row level security;
create policy "public read" on profiles for select using (true);
create policy "public read" on posts for select using (true);
create policy "public read" on votes for select using (true);
```

`supabase/seed.sql` (large enough that the missing indexes hurt):

```sql
insert into profiles (username)
select 'user_' || g from generate_series(1, 1000) g;

with p as (select array_agg(id) as ids from profiles)
insert into posts (author_id, title, body, created_at)
select p.ids[1 + (g % 1000)],
       'Idea #' || g,
       repeat('This startup will change everything. ', 40),
       now() - (g || ' minutes')::interval
from p, generate_series(1, 100000) g;

insert into votes (post_id)
select 1 + floor(random() * 100000)::int
from generate_series(1, 500000);
```

## Intentional weak points

Each one is a common vibe-coded mistake, and each one maps to a fix prompt. Build them on purpose.

1. Heavy feed query
   - Feed loads 200 posts at once, `select *` (includes the long `body`), joined with author, ordered by `created_at` without an index.
   - `supabase.from('posts').select('*, author:profiles(*)').order('created_at', { ascending: false }).limit(200)`
2. N+1 vote counts
   - For each of the first 20 posts, a separate request for its vote count. `votes.post_id` has no index, so each one scans 500k rows.
   - `supabase.from('votes').select('*', { count: 'exact', head: true }).eq('post_id', post.id)`
3. AI call on every page load
   - The "Idea of the day" card calls the `ai-summary` Edge Function on every feed load, with no cache.

If the app does not break under about 150 users, tighten the resource caps first, then make weak point 2 heavier (more posts with counts).

## Edge Function: ai-summary

Simulates an LLM call, so load tests cost nothing.

```ts
// supabase/functions/ai-summary/index.ts
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { post_id } = await req.json();
  await new Promise((r) => setTimeout(r, 2000)); // simulated LLM latency
  return new Response(
    JSON.stringify({ roast: `Idea #${post_id}: bold, but who pays for it?` }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
```

If `supabase start` doesn't pick it up, run `supabase functions serve`.

## Journey

The calls one visitor makes on the feed, in order. Write down the real list after building (browser Network tab) and send it to the Tester side.

1. `POST http://localhost:8080/shield/admit` (only on the `shield` branch)
2. `GET /rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200`
3. `HEAD /rest/v1/votes?post_id=eq.<id>` × 20
4. `POST /functions/v1/ai-summary`

Supabase calls need headers `apikey: <anon key>` and `Authorization: Bearer <anon key>`.

## Shield script (shield.js)

A plain JavaScript file, no build step. It lives in the repo at `our-side/public/shield.js`, and the Tester Backend serves it at `http://localhost:8080/shield.js`, the way our CDN would in the real product.

What it does:

1. Runs before the app's bundle.
2. Asks our admit service whether this visitor can enter.
3. Admitted: lets the app start, then sends a heartbeat every 10 seconds.
4. Queued: shows a full-screen waiting page with the position and an email form, retries every 5 seconds, and lets the app start once admitted.
5. Our service unreachable or slower than 2 seconds: lets the app start (fail open), so we never make the customer's app worse.

The app's own code never runs for a queued visitor, so the database never sees them.

### Install in the app

Two changes. This is what the install prompt must produce.

`index.html`, in `<head>`, before the app's script:

```html
<script
  src="http://localhost:8080/shield.js"
  data-site="idea-roaster"
  data-api="http://localhost:8080"></script>
```

It must be a normal script (no `async` or `defer`). The Vite bundle is a module script, which the browser runs later, so `shield.js` always runs first.

`src/main.tsx`, wait for the Shield before rendering:

```tsx
const shieldReady: Promise<void> = (window as any).SpikeShield?.ready ?? Promise.resolve();

shieldReady.then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
```

If `shield.js` fails to load, `SpikeShield` is undefined and the app starts normally.

### shield.js

```js
(function () {
  var tag = document.currentScript;
  var site = tag.getAttribute("data-site");
  var api = tag.getAttribute("data-api");

  var KEY = "spike_shield_session";
  var sessionId = localStorage.getItem(KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(KEY, sessionId);
  }

  var release;
  var ready = new Promise(function (resolve) { release = resolve; });
  window.SpikeShield = { ready: ready };

  function admit() {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 2000);
    return fetch(api + "/shield/admit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: site, sessionId: sessionId }),
      signal: ctrl.signal,
    })
      .then(function (r) { return r.json(); })
      .catch(function () { return { status: "admitted" }; }) // fail open
      .finally(function () { clearTimeout(timer); });
  }

  function start() {
    hideWaitingPage();
    release();
    setInterval(admit, 10000); // heartbeat
  }

  function check() {
    admit().then(function (res) {
      if (res.status === "admitted") return start();
      showWaitingPage(res.position);
      setTimeout(check, 5000);
    });
  }

  // Waiting page: inline styles only, no requests except our API.
  var page;
  function showWaitingPage(position) {
    if (!page) {
      page = document.createElement("div");
      page.id = "spike-shield";
      page.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
        "justify-content:center;background:#fff;font-family:system-ui,sans-serif;";
      page.innerHTML =
        '<div style="max-width:360px;padding:24px;text-align:center">' +
        "<h1 style=\"font-size:22px\">This app is very popular right now</h1>" +
        '<p>You\'re number <strong id="ss-pos"></strong> in line. This page will let you in automatically.</p>' +
        '<form id="ss-form" style="margin-top:16px">' +
        '<p>Or leave your email and we\'ll tell you when you\'re in.</p>' +
        '<input id="ss-email" type="email" required placeholder="you@example.com" style="padding:8px;width:100%">' +
        '<button style="margin-top:8px;padding:8px 16px">Notify me</button>' +
        '<p style="font-size:12px;color:#666">We only use your email to tell you when you can get in.</p>' +
        "</form></div>";
      (document.body || document.documentElement).appendChild(page);
      page.querySelector("#ss-form").addEventListener("submit", function (e) {
        e.preventDefault();
        fetch(api + "/shield/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId: site,
            sessionId: sessionId,
            email: page.querySelector("#ss-email").value,
          }),
        });
        page.querySelector("#ss-form").innerHTML = "<p>Thanks! We'll email you when you're in.</p>";
      });
    }
    page.querySelector("#ss-pos").textContent = position;
  }

  function hideWaitingPage() {
    if (page) page.remove();
  }

  check();
})();
```

The script runs in `<head>`, before `<body>` exists. The waiting page is added to `document.documentElement` in that case, which still covers the screen.

### Install prompt

Our product claim is "one prompt in Lovable". We can't run Lovable at the demo, so we show the prompt and switch to a `shield` branch that has it applied. Apply the prompt with any AI coding tool to make that branch, and fix the prompt until it works in one go:

> Add Spike Shield to this app. In index.html, inside `<head>` and before any other script, add `<script src="http://localhost:8080/shield.js" data-site="idea-roaster" data-api="http://localhost:8080"></script>` without async or defer. In src/main.tsx, wait for `window.SpikeShield?.ready` (use `Promise.resolve()` if it is undefined) before calling createRoot().render.

## Fix prompts

The Tester dashboard shows these after a check. Apply each one with an AI coding tool on its own branch, and confirm with k6 that it removes the weak point.

1. `fix/feed`, heavy feed query
   > Load the feed 20 posts at a time with pagination. Select only id, title, created_at and the author's username, not the post body. Add a database index on posts(created_at desc).
2. `fix/votes`, N+1 vote counts
   > Don't query vote counts per post. Create a Postgres view posts_with_votes that returns each post with its vote count in one query, use it in the feed, and add an index on votes(post_id).
3. `fix/ai`, AI call on every page load
   > Don't call ai-summary when the feed loads. Call it only when the user clicks "Roast this idea", and save the result in a roasts table so each idea is roasted only once.

## Check it breaks (before the Tester side is ready)

Quick load test with [k6](https://k6.io):

```js
// spike.js — run: k6 run -e URL=http://localhost:54321 -e KEY=<anon key> spike.js
import http from "k6/http";

export const options = {
  stages: [
    { duration: "20s", target: 150 },
    { duration: "30s", target: 150 },
    { duration: "10s", target: 0 },
  ],
};

export default function () {
  const h = { headers: { apikey: __ENV.KEY, Authorization: `Bearer ${__ENV.KEY}` } };
  const feed = http.get(
    `${__ENV.URL}/rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200`, h);
  const posts = feed.status === 200 ? feed.json().slice(0, 20) : [];
  for (const p of posts) {
    http.head(`${__ENV.URL}/rest/v1/votes?post_id=eq.${p.id}`,
      { headers: { ...h.headers, Prefer: "count=exact" } });
  }
  http.post(`${__ENV.URL}/functions/v1/ai-summary`, JSON.stringify({ post_id: 1 }),
    { headers: { ...h.headers, "Content-Type": "application/json" } });
}
```

Expected: errors (5xx, timeouts) and p95 of several seconds at the target load. This script skips the Shield. Testing with the Shield is done by the Tester Backend's replay.

## Checklist

1. Local Supabase running, schema and seed loaded
2. Fake App built with the three weak points, served with `vite preview`
3. IP, Fake App URL, Supabase URL, anon key sent to the Tester side
4. Resource caps in `user-side/scripts/cap.sh`, `start.sh` works from a fresh clone, k6 shows a stable breaking point
5. Journey list written from the Network tab and sent
6. `shield.js` committed, works against the Tester's admit service: queued, waiting page, email sent, admitted
7. `shield` branch made from the install prompt
8. `fix/feed`, `fix/votes`, `fix/ai` branches made from the fix prompts and checked with k6
