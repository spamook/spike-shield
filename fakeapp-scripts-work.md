# Fake App + Shield: Work Spec

Work for the Fake App side. See [team-plan.md](team-plan.md) for roles and [spike-shield.md](spike-shield.md) for the product.

## Goal

Build a Lovable app that looks like a real vibe-coded app, breaks under a small spike for clear reasons, and stays up once the Shield is on.

What you hand back to the Tester side:

- Fake App URL
- Supabase URL and anon key
- The list of calls the page makes (see Journey)
- Fix prompts you have tested in Lovable (see Fix prompts)

## Setup

1. Create a Supabase project on the free tier. Use your own project, not Lovable Cloud, so we can show errors and connections live in the Supabase dashboard during the demo.
2. Create a Lovable project on your account and connect it to that Supabase project.
3. Publish it to `*.lovable.app`.

## App concept: Idea Roaster

A viral-style app: people post startup ideas, the feed shows them with votes, and an AI "roasts" an idea.

Pages:

- `/` Feed: list of ideas (title, author, vote count) and an "Idea of the day" card with an AI roast.
- `/idea/:id` Detail: full idea text and a "Roast this idea" button.
- `/admin` Hidden page with the Shield on/off switch (for the demo).

## Database

Run in the Supabase SQL editor (or let Lovable create it, then compare).

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

Seed data (large enough that the missing indexes hurt):

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

If the free tier does not break under about 100 users, make weak point 2 heavier (more posts with counts), not the Shield weaker.

## Edge Function: ai-summary

Simulates an LLM call so we don't pay for real AI during load tests.

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

## Journey

The calls one visitor makes on the feed, in order. Write down the real list after building (check the browser Network tab) and send it to the Tester side.

1. `POST /rest/v1/rpc/shield_admit` (only when the Shield is installed)
2. `GET /rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200`
3. `HEAD /rest/v1/votes?post_id=eq.<id>` × 20
4. `POST /functions/v1/ai-summary`

All requests need headers `apikey: <anon key>` and `Authorization: Bearer <anon key>`.

## Shield

A queue in front of the app. When too many visitors are active, new ones see a waiting page with an email form and are let in first-come-first-served.

Parts:

- Tables for config, sessions and the waitlist.
- A database function `shield_admit` that decides admitted or queued. It runs as one transaction with a lock, so two visitors can't take the last slot at the same time. It is called as RPC, so no extra Edge Function is needed.
- A `ShieldGate` component that wraps the whole app.

### Shield SQL

```sql
create table shield_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  max_active int not null default 30,
  session_ttl_seconds int not null default 30
);
insert into shield_config default values;

create table shield_sessions (
  id uuid primary key,
  status text not null check (status in ('active', 'queued')),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index on shield_sessions (status, created_at);

create table waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  created_at timestamptz not null default now()
);

alter table shield_config enable row level security;
alter table shield_sessions enable row level security;  -- no policies: only via shield_admit
alter table waitlist enable row level security;
create policy "public read" on shield_config for select using (true);
create policy "anon insert" on waitlist for insert with check (true);

create or replace function shield_admit(p_session uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg shield_config;
  s shield_sessions;
  active_count int;
  ahead int;
begin
  select * into cfg from shield_config where id = 1;
  if not cfg.enabled then
    return json_build_object('status', 'admitted');
  end if;

  perform pg_advisory_xact_lock(42);

  -- drop visitors who stopped sending heartbeats
  delete from shield_sessions
  where last_seen < now() - make_interval(secs => cfg.session_ttl_seconds);

  select * into s from shield_sessions where id = p_session;
  if not found then
    insert into shield_sessions (id, status) values (p_session, 'queued')
    returning * into s;
  else
    update shield_sessions set last_seen = now() where id = p_session
    returning * into s;
  end if;

  if s.status = 'active' then
    return json_build_object('status', 'admitted');
  end if;

  select count(*) into active_count from shield_sessions where status = 'active';
  select count(*) into ahead from shield_sessions
  where status = 'queued' and created_at < s.created_at;

  -- first-come-first-served: admit only if free slots cover everyone ahead
  if ahead < cfg.max_active - active_count then
    update shield_sessions set status = 'active' where id = p_session;
    return json_build_object('status', 'admitted');
  end if;

  return json_build_object('status', 'queued', 'position', ahead + 1);
end;
$$;

grant execute on function shield_admit(uuid) to anon;
```

Rules this implements:

- Shield off: everyone is admitted, and the function returns before touching any table.
- A visitor is active until they stop sending heartbeats for `session_ttl_seconds`.
- Queued visitors keep their place as long as they keep polling.
- `max_active` should be below the breaking point the Tester side finds (e.g. breaks at 80 → set 30).

### ShieldGate component

Wrap the whole app with it (in `App.tsx`), so no page queries run before the visitor is admitted. Otherwise queued visitors would still load the database.

```tsx
const SESSION_KEY = "shield_session";

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

type Gate = { status: "checking" | "admitted" | "queued"; position?: number };

export function ShieldGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>({ status: "checking" });

  useEffect(() => {
    const id = getSessionId();
    let timer: number;
    const check = async () => {
      const { data, error } = await supabase.rpc("shield_admit", { p_session: id });
      // fail closed: if the check fails, the app is overloaded, so wait
      const next: Gate = error ? { status: "queued" } : data;
      setGate(next);
      // admitted: heartbeat every 10s; queued: retry every 5s
      timer = window.setTimeout(check, next.status === "admitted" ? 10000 : 5000);
    };
    check();
    return () => clearTimeout(timer);
  }, []);

  if (gate.status === "checking") return <Spinner />;
  if (gate.status === "queued") return <WaitingRoom position={gate.position} />;
  return <>{children}</>;
}
```

Heartbeat (10s) must be shorter than `session_ttl_seconds` (30s), or active visitors get dropped.

### Waiting page

- Message: "This app is very popular right now. You're number N in line."
- Position updates on each retry.
- Email form: insert into `waitlist`, then show "We'll email you when you're in."
- Keep it light: no images from the database, no other queries.

### Admin switch

`/admin` page: toggle `shield_config.enabled` and edit `max_active`. For the demo only. Needs an update policy or a small RPC. If short on time, flip it in the Supabase SQL editor instead:

```sql
update shield_config set enabled = true where id = 1;
```

### Install prompt

The Shield must install with one prompt, because that is our product claim. Draft it, test it on a fresh copy of the Fake App, and fix it until it works in one go. Start from:

> Add a visitor queue to this app. Create tables shield_config, shield_sessions and waitlist and a Postgres function shield_admit with the SQL below. Wrap the whole app in a ShieldGate component that calls supabase.rpc('shield_admit') with a session id stored in localStorage, re-checks every 10 seconds when admitted and every 5 seconds when queued, and shows a waiting page with the queue position and an email form that saves to the waitlist table. Do not render any other page until the visitor is admitted.
>
> (paste Shield SQL here)

## Fix prompts

The Tester side shows these after a check. Test each one in Lovable on a copy of the app, and confirm it removes the weak point.

1. Heavy feed query
   > Load the feed 20 posts at a time with pagination. Select only id, title, created_at and the author's username, not the post body. Add a database index on posts(created_at desc).
2. N+1 vote counts
   > Don't query vote counts per post. Create a Postgres view posts_with_votes that returns each post with its vote count in one query, use it in the feed, and add an index on votes(post_id).
3. AI call on every page load
   > Don't call ai-summary when the feed loads. Call it only when the user clicks "Roast this idea", and save the result in a roasts table so each idea is roasted only once.

## Check it breaks (before the Tester side is ready)

Quick load test from your laptop with [k6](https://k6.io):

```js
// spike.js — run: k6 run -e URL=https://xxx.supabase.co -e KEY=<anon key> spike.js
import http from "k6/http";

export const options = {
  stages: [
    { duration: "20s", target: 100 },
    { duration: "30s", target: 100 },
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

Expected without Shield: errors (5xx, timeouts) and p95 of several seconds at around 100 users. Only run it against our own project, and keep runs short so the free tier isn't paused.

## Checklist

1. Supabase project created, tables and seed data loaded
2. Fake App built with the three weak points, published
3. URL, Supabase URL, anon key sent to the Tester side
4. k6 run shows the app breaking
5. Journey list written from the Network tab and sent
6. Shield SQL and ShieldGate working, admin switch working
7. Install prompt works in one go on a fresh copy
8. Fix prompts tested
9. With Shield on, k6 run shows the waiting page instead of errors (the script must call shield_admit first; ask the Tester side for the replay)
