# Spike Shield

Go viral without going down or going broke.

## Problem

Social media can send thousands of users to a new app overnight. Vibecoders build and deploy apps with Lovable without knowing anything about infrastructure, and the spike itself is what hurts them:

- The database falls over, the app goes down, and the users the buzz brought in are lost.
- The bill explodes because of usage-based pricing, especially when the app calls AI on every visit.

Predicting the exact breaking point doesn't solve this. Surviving the spike does.

## User

Lovable builders. They aren't infrastructure experts, they ship fast, and they fix problems by prompting AI.

A published Lovable app is static files (HTML, JS, CSS) on Lovable's CDN, talking directly to a Supabase backend. The CDN doesn't break under load. Supabase does.

## Solution

The Shield: a script the builder adds to the app with one prompt in Lovable.

- Queue: our service counts active visitors. Above the threshold, new visitors see a waiting page and never reach the app's database or its AI calls.
- Waiting page: shows the visitor's place in line and lets them in automatically when a slot frees up. A visitor who closes the page frees their place at once.
- Email capture (paid): the waiting page asks for an email. When a slot frees up, we email "you're in". One waiting page for all plans: the email form only shows when the site's plan includes it. Not in the hackathon demo.
- Fail open: if our service can't be reached, visitors are let in, so the app behaves exactly as it would without us.
- Threshold: set by the builder. A later version suggests it (see Later).

## How the Shield works

```
Visitor ──▶ App (static, CDN)
              │ our script: "can I enter?"
              ▼
          Our admit service ── counts active visitors (heartbeats)
              │
     under threshold            over threshold
              │                        │
              ▼                        ▼
   app starts, talks to       waiting page (+ email form)
   its Supabase               (the database never sees this visitor)
```

- The app doesn't start until our script says the visitor is admitted.
- Admitted visitors send a heartbeat every 10 seconds. A visitor who stops for 30 seconds frees their slot.
- Limit: the script only stops visitors who come through the page. Direct API calls skip it. A later tier can issue a signed pass that the app's Supabase checks.

## Business

Pricing:

| Tier | Price | What |
|---|---|---|
| Free | $0 | Queue and waiting page, dashboard and spike alerts, up to a monthly cap of queued visitors |
| Shield | Flat monthly fee (e.g. $9) | Higher cap, email capture and "you're in" emails |

- The Shield is insurance: one flat fee, and launch day is covered. Builders don't have to predict their traffic.
- Most customers are quiet most months and only a few spike at once, so a flat fee is profitable. The cap protects against extreme cases and abuse.

Why they can't just copy it with AI:

- A do-it-yourself queue runs on their own database, which is the thing that fails during a spike.
- They pay for what a script can't do: a queue that runs outside their database and stays up during their spike, and the waitlist emails. Alerts are free, so every builder knows when the buzz hits.

Competition:

- Waiting rooms (Cloudflare, Queue-it) are priced and built for enterprises.
- Nothing serves one-person vibe-coded apps.

## Architecture (product)

Customers' apps stay on Lovable and Supabase; everything on the right is ours.

```
 Customer's app (Lovable)               Spike Shield (our cloud)
┌─────────────────────────┐            ┌──────────────────────────────┐
│ Lovable CDN             │            │ CDN: shield.js               │
│  static app             │            │                              │
│  (loads our shield.js)  │            │ Edge admit service           │
└────────────┬────────────┘            │  in-memory counters          │
             │ page loads              │                              │
             ▼                         │ Postgres                     │
┌─────────────────────────┐   admit,   │  accounts, thresholds,       │
│ Visitor's browser       │─heartbeat─▶│  waitlist, stats             │
└────────────┬────────────┘            │                              │
             │ admitted only           │ Dashboard (for the builder)  │
             ▼                         └──────────────────────────────┘
┌─────────────────────────┐
│ Customer's Supabase     │
└─────────────────────────┘
```

| Part | Traffic | Runs on |
|---|---|---|
| Shield script | Static | CDN |
| Admit service | Every visitor plus heartbeats during a spike (10,000 visitors ≈ 1,000 writes per second) | Edge functions with an in-memory counter (e.g. Cloudflare Workers + Durable Objects, or a server + Redis) |
| Accounts, thresholds, emails, stats | Low | Normal database (Postgres) |

A CDN alone can't run the admit service: every answer is different ("admitted", "queued, number 42"), so it can't be cached.

## Hackathon setup (demo)

We run the whole demo on one laptop, with no Lovable and no cloud.

- Fake App: a copy of a typical Lovable app (Vite + React + supabase-js), served twice: without the Shield on `:4173`, with the Shield on `:4174`.
- Supabase: runs locally in Docker. CPU and memory are capped so it breaks at a predictable point.
- Shield service: a small Node process that serves `shield.js` and runs the admit service, all in memory. It stands in for our cloud.
- Rush tester: not part of the product. Real browsers (Playwright) visit the Fake App like a spike of real visitors, so they go through `shield.js`. Its own dashboard shows failed requests and queued visitors.

```
┌──────────────────────────────┐  visits  ┌────────────────────────────┐
│ Rush tester :8080            │─────────▶│ Fake App                   │
│  Playwright browsers         │          │  :4173 without Shield      │
│  tester dashboard            │          │  :4174 with Shield         │
└──────────────┬───────────────┘          └────────────────────────────┘
               │ stats           browsers: admit      │ admitted only
               ▼                          ▼           ▼
┌──────────────────────────────┐   ┌─────────────────────────────┐
│ Shield :8090                 │   │ Supabase in Docker :54321   │
│  shield.js, admit            │   │  capped CPU and memory      │
└──────────────────────────────┘   └─────────────────────────────┘
```

The demo:

1. A short introduction.
2. Run the tester against the app without the Shield.
3. The tester dashboard shows many failed requests.
4. Introduce the Shield and how to install it: one prompt in Lovable.
5. Run the tester again against the app with the Shield. We open the app in our own browser too, land on the waiting page and get in after about 20–30 seconds. We mention that email capture comes next.
6. The dashboard shows no failed requests, and part of the visitors waiting in the queue.

Details: [team-plan.md](team-plan.md), [tester-work.md](tester-work.md) and [fakeapp-scripts-work.md](fakeapp-scripts-work.md).

## Why we don't load-test customer apps

We first planned a check that spike-tests any Lovable app from its URL. We dropped it:

- A URL isn't enough for a trustworthy number: the result depends on the schema, indexes and data size we can't see.
- Supabase and Lovable don't allow load tests against apps we don't own, and such a tool could be misused as an attack.

Our rush tester only runs against our own Fake App, to show the Shield working.

## Later

If time allows at the hackathon, then in the product:

- Login for builders: the script needs a site key so only the owner's app writes to our service.
- Email capture on the waiting page and "you're in" emails, sent a few at a time as slots free up, so returning visitors don't cause a second spike.
- Builder dashboard: active visitors, queue length and emails on the waitlist.
- Threshold suggestion from static analysis of the app's HTML, CSS and JS (e.g. `select *` without a limit, one request per list item, an AI call on every page load). No traffic is sent to the app.
- Fix prompts for the problems static analysis finds.

## Risks

- Our admit service becomes part of every customer's launch. It must not go down, and if it does, visitors are let in.
- Waitlist emails are personal data, and we are in the EU. GDPR applies: a consent line on the waiting page and a data processing agreement with each customer.

## Why Lovable only

- Lovable apps share the same setup (static frontend + Supabase), so the install is the same one prompt for every app.
- The hackathon audience uses Lovable.
- Trade-off: a smaller market story at first.
- Expansion: other builders on Supabase (Bolt, v0) next, then any web app, since the script only needs a page.
