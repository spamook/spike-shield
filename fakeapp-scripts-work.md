# Target Side: Fake App + Shield

Work spec for the Target side (`user-side/`). See [team-plan.md](team-plan.md) for roles, ports and the API contract, and [spike-shield.md](spike-shield.md) for the product.

## Goal

Build a copy of a typical Lovable app that breaks under a small spike for clear reasons, and the Shield (`shield.js` plus the admit service) that keeps it up.

What you hand to the Tester side:

- The Fake App served twice: without the Shield on `:4173`, with the Shield on `:4174`
- Page states on `<body data-state>` (see Page states), so the rush tester can tell what a visitor sees
- The Shield service on `localhost:8090`, matching the admit, leave and stats APIs in team-plan

## Your folders

```
spike-shield/
├─ user-side/                # all yours
│  ├─ supabase/              # config, migrations, seed, functions
│  ├─ src/, index.html       # Fake App (Vite + React)
│  ├─ shield/                # Shield service (its own package.json)
│  │  ├─ server.ts           # admit, leave, config, stats, serves public/
│  │  ├─ admit.ts            # admit logic (in memory)
│  │  └─ public/shield.js    # the script the Fake App loads
│  ├─ scripts/start.sh       # starts everything on this side
│  └─ scripts/cap.sh         # Docker resource caps
└─ tester/                   # Koki's: rush tester and its dashboard
```

Only Supabase runs in Docker (the CLI needs it). The Fake App runs directly with `vite preview`, the Shield service with `tsx`.

## Stack

The same stack Lovable generates, run locally:

- Vite + React + TypeScript
- `@supabase/supabase-js`
- Local Supabase in Docker (Postgres, REST API, Edge Functions, Studio)

Shield service (stands in for our hosted service, so not Lovable's stack):

- Node 20+, TypeScript run with `tsx` (no build step), Express
- No database: everything in memory

Prerequisites: Node 20+, Docker Desktop, Supabase CLI, git.

## Setup

```bash
# from the repo root
npm create vite@latest user-side -- --template react-ts
cd user-side
npm install @supabase/supabase-js
supabase init           # project_id in supabase/config.toml becomes "user-side"
supabase start          # prints API URL, anon key, Studio URL

# Shield service, its own package
mkdir shield && cd shield
npm init -y
npm install express
npm install -D tsx typescript @types/express
```

- `shield/package.json`: `"start": "tsx server.ts"`.

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

- Serve the production build, like Lovable's CDN does. Two builds from the same code, one without and one with the Shield (see Two builds):

  ```bash
  npm run build -- --outDir dist-plain
  SHIELD=1 npm run build -- --outDir dist-shield
  npx vite preview --outDir dist-plain --port 4173 &
  npx vite preview --outDir dist-shield --port 4174
  ```

- Check that the API answers:

  ```bash
  curl "http://localhost:54321/rest/v1/posts?limit=1" -H "apikey: <anon key>"
  ```

## Resource caps

A laptop is much stronger than a free-tier Supabase, and in the demo the rush tester's browsers run on the same laptop. Real browsers are heavy, so the tester can only run a limited number of visitors (Koki measures it first, e.g. 60). Cap the containers so that:

- The app breaks at about 20–30 visitors at the same time, run after run.
- The app stays healthy at the Shield threshold (10).

```bash
docker ps --format "{{.Names}}"          # find supabase_db_*, supabase_rest_*, supabase_edge_runtime_*
docker update --cpus 1 --memory 1g supabase_db_user-side
docker update --cpus 0.5 --memory 512m supabase_rest_user-side
```

- Container names end with the `project_id` from `supabase/config.toml`. Check them with `docker ps`.
- Caps reset when Supabase restarts. Keep the commands in `user-side/scripts/cap.sh`; `start.sh` runs it after `supabase start`.
- Tune the numbers roughly with the k6 script below, then with the rush tester, until the breaking point is stable across runs.
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
(cd shield && npm install && THRESHOLD=10 npm start) &   # Shield service on :8090
npm install
npm run build -- --outDir dist-plain
SHIELD=1 npm run build -- --outDir dist-shield
npx vite preview --outDir dist-plain --port 4173 &     # without the Shield
npx vite preview --outDir dist-shield --port 4174      # with the Shield
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
   - For each of the first 20 posts, a separate request for its vote count. Each post card fetches its own count when it mounts, so all 20 go out at the same moment. `votes.post_id` has no index, so each one scans 500k rows.
   - `supabase.from('votes').select('*', { count: 'exact', head: true }).eq('post_id', post.id)`
3. AI call on every page load
   - The "Idea of the day" card calls the `ai-summary` Edge Function on every feed load, with no cache.

If the app does not break at the planned number of users, tighten the resource caps first, then make weak point 2 heavier (more posts with counts).

## Page states

The rush tester reads what each visitor sees from the page. Set `data-state` on `<body>`:

- `loading`: the app is starting or waiting for the feed
- `ready`: the feed rendered with data
- `error`: a Supabase call failed; show a visible error message too (e.g. "Something went wrong"), so the audience sees it

The waiting page from `shield.js` has `id="spike-shield"`, which the tester checks first.

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

## Shield script (shield.js)

A plain JavaScript file, no build step. It lives in the repo at `user-side/shield/public/shield.js`, and the Shield service serves it at `http://localhost:8090/shield.js`, the way our CDN would in the real product.

What it does:

1. Runs before the app's bundle.
2. Asks our admit service whether this visitor can enter.
3. Admitted: lets the app start, then sends a heartbeat every 10 seconds.
4. Queued: shows a full-screen waiting page with the position, retries every 5 seconds, and lets the app start once admitted.
5. Page closed: tells our service the visitor left, so their slot or place in line frees at once.
6. Our service unreachable or slower than 2 seconds: lets the app start (fail open), so we never make the customer's app worse.

The app's own code never runs for a queued visitor, so the database never sees them.

No email form in the demo. In the pitch we say it's coming: leave an email on the waiting page, get "you're in" when a slot frees up (see Stretch in team-plan).

### Install in the app

Two changes. This is what the install prompt must produce.

`index.html`, in `<head>`, before the app's script:

```html
<script
  src="http://localhost:8090/shield.js"
  data-site="idea-roaster"
  data-api="http://localhost:8090"></script>
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

  // Leaving frees the slot at once instead of after 30 seconds.
  // A plain string is sent as text/plain, which needs no CORS preflight.
  window.addEventListener("pagehide", function () {
    navigator.sendBeacon(api + "/shield/leave", JSON.stringify({ siteId: site, sessionId: sessionId }));
  });

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
        '<p>You\'re number <strong id="ss-pos"></strong> in line.</p>' +
        "<p>Keep this tab open. We'll let you in automatically.</p>" +
        "</div>";
      (document.body || document.documentElement).appendChild(page);
    }
    page.querySelector("#ss-pos").textContent = position;
  }

  function hideWaitingPage() {
    if (page) page.remove();
  }

  check();
})();
```

- The script runs in `<head>`, before `<body>` exists. The waiting page is added to `document.documentElement` in that case, which still covers the screen.
- A reload also sends "leave", so the visitor goes to the back of the line. Don't reload while demoing the waiting page.

### Install prompt

Our product claim is "one prompt in Lovable". We can't run Lovable at the demo, so in step 4 of the demo we show the prompt and the two changes it makes, then run the tester against the `:4174` build. Try the prompt once with any AI coding tool and fix it until it works in one go:

> Add Spike Shield to this app. In index.html, inside `<head>` and before any other script, add `<script src="http://localhost:8090/shield.js" data-site="idea-roaster" data-api="http://localhost:8090"></script>` without async or defer. In src/main.tsx, wait for `window.SpikeShield?.ready` (use `Promise.resolve()` if it is undefined) before calling createRoot().render.

### Two builds

The demo serves the app without and with the Shield at the same time, so nothing is switched or rebuilt live.

- `src/main.tsx` always waits for `SpikeShield.ready`. Without the script it starts at once, so both builds share it.
- The script tag is added only when `SHIELD=1`, with a small plugin in `vite.config.ts`:

  ```ts
  const shieldTag =
    '<script src="http://localhost:8090/shield.js" data-site="idea-roaster" data-api="http://localhost:8090"></script>';

  export default defineConfig({
    plugins: [
      react(),
      {
        name: "spike-shield",
        transformIndexHtml: (html) =>
          process.env.SHIELD === "1" ? html.replace("<head>", `<head>\n    ${shieldTag}`) : html,
      },
    ],
  });
  ```

- Check both: `:4173` has no `shield.js` in the page source, `:4174` has it as the first script in `<head>`.

## Shield service

`user-side/shield/`, one Node process on `localhost:8090`. It stands in for our hosted admit service, so it runs outside Supabase and stays up when Supabase breaks. Rules and contract in team-plan.

| Method | Path | Used by | What |
|---|---|---|---|
| GET | `/shield.js` | Fake App | Static file from `public/` |
| POST | `/shield/admit` | `shield.js` | Admit or queue a visitor |
| POST | `/shield/leave` | `shield.js` | Drop a visitor who closed the page |
| PUT | `/shield/config` | us, for tuning | Shield on/off and threshold |
| GET | `/shield/stats` | Tester dashboard | Active and queued visitors |

- CORS on all routes (`Access-Control-Allow-Origin: *`, handle `OPTIONS`), since the Fake App runs on ports 4173 and 4174.
- `/shield/leave` gets its body as `text/plain` (from `sendBeacon`). Parse both types: `express.json({ type: ["application/json", "text/plain"] })`.
- Starts with `idea-roaster` enabled and the threshold from the `THRESHOLD` env var (default 10). Only the `:4174` build loads the script, so the Shield can stay on all the time.
- All state is in memory, no database. A restart clears it, which is fine for the demo. The real product keeps sessions in an edge store.
- Keep the admit call fast. Its latency is part of every page load.

```ts
// shield/admit.ts
type Session = { status: "active" | "queued"; firstSeen: number; lastSeen: number };

type Site = {
  enabled: boolean;
  threshold: number;
  sessions: Map<string, Session>;   // insertion order = arrival order
};

const TTL_MS = 30_000;
export const sites = new Map<string, Site>();

export function getSite(id: string): Site {
  let site = sites.get(id);
  if (!site) {
    site = { enabled: true, threshold: Number(process.env.THRESHOLD ?? 10), sessions: new Map() };
    sites.set(id, site);
  }
  return site;
}

export function admit(siteId: string, sessionId: string, now = Date.now()) {
  const site = getSite(siteId);
  if (!site.enabled) return { status: "admitted" };

  for (const [id, s] of site.sessions) {
    if (now - s.lastSeen > TTL_MS) site.sessions.delete(id);
  }

  let s = site.sessions.get(sessionId);
  if (!s) {
    s = { status: "queued", firstSeen: now, lastSeen: now };
    site.sessions.set(sessionId, s);
  }
  s.lastSeen = now;
  if (s.status === "active") return { status: "admitted" };

  let active = 0;
  let ahead = 0;
  for (const o of site.sessions.values()) {
    if (o.status === "active") active++;
    else if (o.firstSeen < s.firstSeen) ahead++;
  }

  // first come, first served: free slots must cover everyone ahead
  if (active + ahead < site.threshold) {
    s.status = "active";
    return { status: "admitted" };
  }
  return { status: "queued", position: ahead + 1 };
}

export function leave(siteId: string, sessionId: string) {
  getSite(siteId).sessions.delete(sessionId);
}

export function configure(siteId: string, enabled: boolean, threshold: number) {
  const site = getSite(siteId);
  site.enabled = enabled;
  site.threshold = threshold;
}

export function stats(siteId: string) {
  const site = getSite(siteId);
  let active = 0, queued = 0;
  for (const s of site.sessions.values()) {
    if (s.status === "active") active++; else queued++;
  }
  return { enabled: site.enabled, threshold: site.threshold, active, queued };
}
```

- Each call scans all sessions. That's fine for a few thousand visitors in the demo.

Test with curl:

```bash
curl -X PUT localhost:8090/shield/config -H "content-type: application/json" -d '{"siteId":"idea-roaster","enabled":true,"threshold":2}'
curl -X POST localhost:8090/shield/admit -H "content-type: application/json" -d '{"siteId":"idea-roaster","sessionId":"a"}'
curl -X POST localhost:8090/shield/leave -H "content-type: text/plain" -d '{"siteId":"idea-roaster","sessionId":"a"}'
curl "localhost:8090/shield/stats?siteId=idea-roaster"
```

With threshold 2, the third new session is queued. After a leave, the next queued session is admitted on its next retry.

## Fix prompts (stretch)

Only after the full demo runs. Not part of the demo flow. Apply each one with an AI coding tool on its own branch, and confirm with k6 that it removes the weak point.

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

Expected: errors (5xx, timeouts) and p95 of several seconds at the target load. k6 is lighter than a real browser, so use it only to tune the caps roughly, then confirm the numbers with the rush tester. This script skips the Shield. Testing with the Shield is done by the rush tester.

## Checklist

1. Local Supabase running, schema and seed loaded
2. Fake App built with the three weak points, served on `:4173` (no script) and `:4174` (with script)
3. `data-state` on `<body>` and a visible error message when a Supabase call fails
4. Resource caps in `user-side/scripts/cap.sh`, `start.sh` works from a fresh clone
5. With the rush tester: the app breaks at a stable number of users, and stays healthy at the threshold
6. Shield service on :8090 matches the contract (curl test passes), and `shield.js` works against it: queued, waiting page, admitted, and closing the tab frees the place at once
7. Install prompt tried once with an AI coding tool and produces the same two changes
8. Stretch: `fix/feed`, `fix/votes`, `fix/ai` branches made from the fix prompts and checked with k6
