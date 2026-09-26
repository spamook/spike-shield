# Spike Shield

Go viral without going down or going broke.

## Problem

Social media can send thousands of users to a new app overnight. Vibecoders can build and deploy apps with Lovable without knowing anything about infrastructure, so they don't know whether their app will survive a spike until it's too late.

When the spike comes, one of two things happens:

- The app goes down, and the users the buzz brought in are lost.
- The bill explodes because of usage-based pricing.

## User

Lovable builders. They aren't infrastructure experts, they ship fast, and they fix problems by prompting AI.

A published Lovable app is static files (HTML, JS, CSS) on Lovable's CDN, talking directly to a Supabase backend. The CDN doesn't break under load. Supabase does.

## Solution

One product, one journey:

1. Check: paste the app URL. We find the app's Supabase calls, simulate a traffic spike, and show a readiness score, the breaking point ("breaks at about 80 users"), the call that breaks first, and a cost estimate.
2. Fix: every problem comes with a prompt to paste into Lovable.
3. Protect: turn on the Shield by adding our script to the app (one prompt in Lovable).
   - Queue: our service counts active visitors. Above the threshold, new visitors see a waiting page and never reach the app's database.
   - Threshold: set from the breaking point the check measured.
   - Email capture: the waiting page asks for an email. When a slot frees up, we email "you're in".
   - Live monitoring: active visitors, queue length and emails captured, with an alert when a spike starts.
   - Budget guard (later): slow down costly actions such as AI calls near a spending limit.
4. Re-check: run the check again and see the score improve.

## How the check works

1. Analyze: fetch the page, download the JS bundle, extract the Supabase URL and anon key, and list every call the app can make (tables, RPCs, Edge Functions).
2. Record: open the app once in a headless browser and log the calls that actually run, in order.
3. Replay: send that journey as hundreds of virtual users.
4. Diagnose: errors and response times per call, the breaking point, and the matching fix prompts.

Steps 1 and 2 alone find code smells (`select *` without a limit, one request per list item, an AI call on every page load). Step 3 answers the real question: which call breaks first, and at how many users.

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
   app starts, talks to       waiting page + email form
   its Supabase               (the database never sees this visitor)
```

- The app doesn't start until our script says the visitor is admitted.
- Admitted visitors send a heartbeat every 10 seconds. A visitor who stops for 30 seconds frees their slot.
- If our service can't be reached, visitors are let in, so the app behaves exactly as it would without us.
- Limit: the script only stops visitors who come through the page. Direct API calls skip it. A later tier can issue a signed pass that the app's Supabase checks.

## Business

Pricing:

| Tier | Price | What |
|---|---|---|
| Free | $0 | The check, a shareable score badge, and a do-it-yourself Shield prompt |
| Shield | Flat monthly fee (e.g. $9) | Hosted queue, threshold from the check, monitoring and alerts, waitlist emails |

- The Shield is insurance: one flat fee, and launch day is covered. Builders don't have to predict their traffic.
- Most customers are quiet most months and only a few spike at once, so a flat fee is profitable. A fair-use cap (e.g. queued visitors per month) protects against extreme cases and abuse.
- The free check and the shareable score bring in users. The breaking point it measures becomes the paid Shield's threshold.

Why they can't just copy it with AI:

- They can copy the do-it-yourself version, and we give it away. It runs on their own database, which is the thing that fails during a spike.
- They pay for what a script can't do: a queue that runs outside their database and stays up during their spike, the measured threshold, monitoring and alerts at 3 a.m., and the waitlist emails.

Competition:

- Load-testing tools (k6, Loader.io) are built for engineers.
- Waiting rooms (Cloudflare, Queue-it) are priced and built for enterprises.
- Nothing serves one-person vibe-coded apps.

## Architecture (product)

The real product. Customers' apps stay on Lovable and Supabase; everything on the right is ours.

```
 Customer's app (Lovable)               Spike Shield (our cloud)
┌─────────────────────────┐            ┌──────────────────────────────┐
│ Lovable CDN             │◀── fetch ──│ Check workers                │
│  static app             │   bundle   │  analyze, record, replay     │
│  (loads our shield.js)  │            │                              │
└────────────┬────────────┘            │ CDN: shield.js               │
             │ page loads              │                              │
             ▼                         │ Edge admit service           │
┌─────────────────────────┐   admit,   │  in-memory counters          │
│ Visitor's browser       │─heartbeat─▶│                              │
└────────────┬────────────┘            │ Postgres                     │
             │ admitted only           │  accounts, thresholds,       │
             ▼                         │  results, waitlist, stats    │
┌─────────────────────────┐            │                              │
│ Customer's Supabase     │◀── spike ──│ Dashboard (for the builder)  │
└─────────────────────────┘  (check)   └──────────────────────────────┘
```

| Part | Traffic | Runs on |
|---|---|---|
| Shield script | Static | CDN |
| Admit service | Every visitor plus heartbeats during a spike (10,000 visitors ≈ 1,000 writes per second) | Edge functions with an in-memory counter (e.g. Cloudflare Workers + Durable Objects, or a server + Redis) |
| Accounts, thresholds, emails, stats | Low | Normal database (Postgres) |
| Check | Short bursts | Cloud workers generating load |

The data is small, but a CDN alone can't run the admit service: every answer is different ("admitted", "queued, number 42"), so it can't be cached.

## Hackathon setup (demo)

We run the whole demo on one laptop, with no Lovable and no cloud.

- Fake App: a copy of a typical Lovable app. Same stack Lovable generates (Vite + React + supabase-js), served with `vite preview`.
- Supabase: runs locally in Docker. CPU and memory are capped so it breaks at a predictable point, and so the load generator on the same laptop doesn't starve it.
- Shield service: a small Node/TypeScript process that serves `shield.js` and runs the admit service and the waitlist, all in memory. It stands in for the CDN and the edge admit service.
- Backend: one Node/TypeScript process that runs the check and the load engine, serves the dashboard, and keeps check results in SQLite. It stands in for the rest of the right side of the product diagram.

```
┌─────────────────────────────────────────┐  loads  ┌─────────────────────────┐
│ Browser (visitor)                       │────────▶│ Fake App (vite preview) │
└──┬────────────────────────────────┬─────┘         │  :4173                  │
   │ shield.js, admit, heartbeat    │ admitted only └─────────────────────────┘
   ▼                                ▼
┌────────────────────┐        ┌─────────────────────────────┐
│ Shield :8090       │        │ Supabase in Docker :54321   │
│  shield.js         │        │  capped CPU and memory      │
│  admit, waitlist   │        │  Postgres, REST, Functions  │
│  in memory         │        └──────────────▲──────────────┘
└─────────▲──────────┘                       │
          │ config, stats, admit             │ spike
┌─────────┴──────────────────────────────────┴───┐
│ Backend :8080                                  │
│  dashboard, check, load engine, SQLite         │
└────────────────────────────────────────────────┘
```

In the pitch: "We run a copy of a typical Lovable + Supabase app locally. The real product tests your live URL."

Fixes and the Shield install are shown as the prompt, then a prepared git branch with the result, since we can't paste into Lovable live.

Details: [team-plan.md](team-plan.md) and [fakeapp-scripts-work.md](fakeapp-scripts-work.md).

## Risks

- A tool that sends heavy traffic to any URL could be misused as an attack. The real product needs an ownership check (e.g. a verification file or meta tag). At the hackathon we only test our own app.
- From a URL alone we can't check pages behind login, and costs are estimates.
- Our admit service becomes part of every customer's launch. It must not go down, and if it does, visitors are let in.
- Waitlist emails are personal data, and we are in the EU. GDPR applies: a consent line on the waiting page and a data processing agreement with each customer.

## Why Lovable only

- Lovable apps share the same setup (static frontend + Supabase), so a URL is enough for an accurate check, and the fix prompts can be specific.
- The hackathon audience uses Lovable.
- Trade-off: a smaller market story at first.
- Expansion: other builders on Supabase (Bolt, v0) next, then any vibe-coded app by connecting the GitHub repo.
